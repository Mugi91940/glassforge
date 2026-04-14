//! Session manager (stream-json architecture).
//!
//! Each user message spawns a fresh `claude -p <msg> --output-format stream-json`
//! child process and streams the parsed JSON events to the frontend. Claude's
//! own session id is captured from the `system/init` event and threaded through
//! subsequent invocations via `--resume <sid>` so the conversation continues.
//!
//! Events emitted on the Tauri bus (per session id `sid`):
//!   - `session://{sid}/status`  → `SessionStatus` transitions
//!   - `session://{sid}/event`   → raw stream-json payload (or synthetic frames)
//!   - `session://{sid}/done`    → emitted once per send_message when the child exits
//!
//! The reader thread owns the child process: kill_session just acquires the
//! mutex, flips `child.kill()`, and lets the reader finish draining stdout
//! before `wait()` reaps the zombie.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Running,
    Error,
    Done,
}

/// When running inside a Flatpak sandbox, `flatpak-spawn --host` invokes
/// commands on the host with a minimal PATH that typically does not include
/// `~/.local/bin` or npm-global bin dirs. Probe a few well-known locations
/// and return the first one that exists, or fall back to the bare name and
/// hope the host's PATH picks it up.
fn resolve_host_claude() -> String {
    if let Ok(home) = std::env::var("HOME") {
        let candidates = [
            format!("{home}/.local/bin/claude"),
            format!("{home}/.npm-global/bin/claude"),
            format!("{home}/.nvm/versions/node/current/bin/claude"),
            "/usr/local/bin/claude".to_string(),
            "/usr/bin/claude".to_string(),
        ];
        for c in candidates.iter() {
            if std::path::Path::new(c).exists() {
                return c.clone();
            }
        }
    }
    "claude".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub project_path: String,
    pub model: Option<String>,
    pub claude_session_id: Option<String>,
    pub status: SessionStatus,
    pub created_at: u64,
}

pub struct SessionHandle {
    info: Mutex<SessionInfo>,
    child: Mutex<Option<Child>>,
}

impl SessionHandle {
    pub fn info(&self) -> SessionInfo {
        self.info
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|p| p.into_inner().clone())
    }
}

#[derive(Default)]
pub struct SessionRegistry {
    inner: RwLock<HashMap<String, Arc<SessionHandle>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, id: String, handle: Arc<SessionHandle>) {
        if let Ok(mut w) = self.inner.write() {
            w.insert(id, handle);
        }
    }

    pub fn remove(&self, id: &str) -> Option<Arc<SessionHandle>> {
        self.inner.write().ok()?.remove(id)
    }

    pub fn get(&self, id: &str) -> Option<Arc<SessionHandle>> {
        self.inner.read().ok()?.get(id).cloned()
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        let Ok(r) = self.inner.read() else {
            return Vec::new();
        };
        r.values().map(|h| h.info()).collect()
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn create_session(
    registry: &SessionRegistry,
    project_path: String,
    model: Option<String>,
) -> Result<SessionInfo> {
    let path = PathBuf::from(&project_path);
    if !path.is_dir() {
        return Err(anyhow!("project_path is not a directory: {}", project_path));
    }

    let id = Uuid::now_v7().to_string();
    let info = SessionInfo {
        id: id.clone(),
        project_path,
        model,
        claude_session_id: None,
        status: SessionStatus::Idle,
        created_at: now_secs(),
    };

    let handle = Arc::new(SessionHandle {
        info: Mutex::new(info.clone()),
        child: Mutex::new(None),
    });

    registry.insert(id, handle);
    Ok(info)
}

pub fn send_message(
    registry: &Arc<SessionRegistry>,
    app: AppHandle,
    id: &str,
    message: String,
    model_override: Option<String>,
) -> Result<()> {
    let handle = registry
        .get(id)
        .ok_or_else(|| anyhow!("session not found: {id}"))?;

    let (project_path, effective_model, claude_session_id) = {
        let info = handle
            .info
            .lock()
            .map_err(|_| anyhow!("info lock poisoned"))?;
        (
            info.project_path.clone(),
            model_override.clone().or_else(|| info.model.clone()),
            info.claude_session_id.clone(),
        )
    };

    let in_flatpak = std::path::Path::new("/.flatpak-info").exists();
    let mut cmd = if in_flatpak {
        let claude_path = resolve_host_claude();
        let mut c = Command::new("flatpak-spawn");
        c.arg("--host");
        c.arg(format!("--directory={}", project_path));
        c.arg(claude_path);
        c
    } else {
        let mut c = Command::new("claude");
        c.current_dir(&project_path);
        c
    };
    cmd.arg("-p").arg(&message);
    cmd.args(["--output-format", "stream-json", "--verbose"]);
    cmd.args(["--permission-mode", "bypassPermissions"]);
    if let Some(m) = &effective_model {
        cmd.args(["--model", m.as_str()]);
    }
    if let Some(sid) = &claude_session_id {
        cmd.args(["--resume", sid.as_str()]);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().context("failed to spawn claude")?;
    let stdout = child.stdout.take().context("no stdout on child")?;
    let stderr = child.stderr.take().context("no stderr on child")?;

    // Stamp the session with the chosen model now, before the child starts
    // producing output, so the UI reflects "currently running model" right
    // away.
    {
        let mut info = handle
            .info
            .lock()
            .map_err(|_| anyhow!("info lock poisoned"))?;
        info.status = SessionStatus::Running;
        if let Some(m) = effective_model {
            info.model = Some(m);
        }
    }

    {
        let mut slot = handle
            .child
            .lock()
            .map_err(|_| anyhow!("child lock poisoned"))?;
        *slot = Some(child);
    }

    let status_event = format!("session://{id}/status");
    let event_event = format!("session://{id}/event");
    let done_event = format!("session://{id}/done");

    let _ = app.emit(&status_event, SessionStatus::Running);

    // Echo the user's prompt as a synthetic event so the chat UI can render
    // it immediately without waiting for claude to ack.
    let _ = app.emit(
        &event_event,
        serde_json::json!({
            "type": "user_text",
            "text": message,
        }),
    );

    // Stderr drain — runs in its own tiny thread so we can show stderr lines
    // without blocking stdout parsing.
    let stderr_app = app.clone();
    let stderr_event = event_event.clone();
    thread::Builder::new()
        .name(format!("glassforge-claude-stderr-{id}"))
        .spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if line.is_empty() {
                    continue;
                }
                let _ = stderr_app.emit(
                    &stderr_event,
                    serde_json::json!({
                        "type": "stderr",
                        "text": line,
                    }),
                );
            }
        })
        .context("failed to spawn stderr reader thread")?;

    // Stdout reader — parses each line as JSON, emits to the frontend, and
    // captures claude's session id from the init event so subsequent calls
    // can pass `--resume`.
    let reader_app = app.clone();
    let reader_id = id.to_string();
    let reader_handle = handle.clone();
    thread::Builder::new()
        .name(format!("glassforge-claude-stdout-{id}"))
        .spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(&line) {
                    Ok(val) => {
                        capture_session_id(&reader_handle, &val);
                        let _ = reader_app.emit(&event_event, val);
                    }
                    Err(_) => {
                        let _ = reader_app.emit(
                            &event_event,
                            serde_json::json!({
                                "type": "raw",
                                "text": line,
                            }),
                        );
                    }
                }
            }

            // stdout closed — reap the child so we don't leave a zombie.
            let reaped = {
                let mut slot = reader_handle.child.lock().ok();
                slot.as_mut().and_then(|o| o.take())
            };
            let exit_ok = reaped
                .map(|mut c| c.wait().map(|s| s.success()).unwrap_or(false))
                .unwrap_or(false);

            let next_status = if exit_ok {
                SessionStatus::Idle
            } else {
                SessionStatus::Error
            };
            if let Ok(mut info) = reader_handle.info.lock() {
                info.status = next_status;
            }
            let _ = reader_app.emit(&status_event, next_status);
            let _ = reader_app.emit(
                &done_event,
                serde_json::json!({
                    "session_id": reader_id,
                    "ok": exit_ok,
                }),
            );
        })
        .context("failed to spawn stdout reader thread")?;

    Ok(())
}

fn capture_session_id(handle: &SessionHandle, val: &Value) {
    let obj = match val.as_object() {
        Some(o) => o,
        None => return,
    };
    // claude's init line is `{"type":"system","subtype":"init","session_id":"..."}`.
    // We also accept a session_id on any event as a best-effort fallback.
    let sid = obj
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if let Some(sid) = sid {
        if let Ok(mut info) = handle.info.lock() {
            if info.claude_session_id.as_deref() != Some(sid.as_str()) {
                info.claude_session_id = Some(sid);
            }
        }
    }
}

pub fn kill_session(registry: &SessionRegistry, id: &str) -> Result<()> {
    let handle = registry
        .get(id)
        .ok_or_else(|| anyhow!("session not found: {id}"))?;
    let mut slot = handle
        .child
        .lock()
        .map_err(|_| anyhow!("child lock poisoned"))?;
    if let Some(child) = slot.as_mut() {
        child.kill().context("kill child")?;
    }
    Ok(())
}

pub fn list_sessions(registry: &SessionRegistry) -> Vec<SessionInfo> {
    registry.list()
}

pub fn remove_session(registry: &SessionRegistry, id: &str) -> Result<()> {
    // Ensure no child is still running before we drop the handle.
    let _ = kill_session(registry, id);
    registry.remove(id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_starts_empty() {
        let r = SessionRegistry::new();
        assert!(r.list().is_empty());
        assert!(r.get("nope").is_none());
    }

    #[test]
    fn status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&SessionStatus::Running).unwrap(),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&SessionStatus::Idle).unwrap(),
            "\"idle\""
        );
    }

    #[test]
    fn now_secs_is_non_zero() {
        assert!(now_secs() > 0);
    }

    #[test]
    fn capture_session_id_updates_handle() {
        let info = SessionInfo {
            id: "local".to_string(),
            project_path: "/tmp".to_string(),
            model: None,
            claude_session_id: None,
            status: SessionStatus::Idle,
            created_at: 0,
        };
        let handle = SessionHandle {
            info: Mutex::new(info),
            child: Mutex::new(None),
        };
        let val: Value =
            serde_json::from_str(r#"{"type":"system","subtype":"init","session_id":"abc-123"}"#)
                .unwrap();
        capture_session_id(&handle, &val);
        assert_eq!(handle.info().claude_session_id.as_deref(), Some("abc-123"));
    }
}
