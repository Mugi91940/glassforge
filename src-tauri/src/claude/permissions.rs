//! Per-session permission broker for "manual" mode.
//!
//! Claude hooks are regular shell commands invoked on PreToolUse. The
//! hook receives the tool call JSON on stdin and decides allow/deny via
//! its exit code (0 = allow, 2 = block). We exploit that: our hook is a
//! tiny python script that connects to a per-session Unix socket, ships
//! the JSON over, and waits for a decision string from this Rust broker.
//!
//! The broker runs one acceptor thread per registered session. When a
//! connection comes in it parses the tool-call JSON, emits a Tauri event
//! with a fresh request id, and parks the stream in a pending map. The
//! frontend shows an approval modal and calls [`PermissionBroker::resolve`]
//! which writes the reply back to the parked stream — which wakes the hook
//! script and lets claude proceed (or blocks the tool call).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// Decision sent back from the frontend.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Decision {
    /// Allow this single call.
    Allow,
    /// Allow this call and auto-allow everything for the rest of this session.
    AllowSession,
    /// Block this call. Claude's model sees a block reason and moves on.
    Deny,
}

/// Payload emitted to the frontend when claude asks for permission.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub session_id: String,
    pub request_id: String,
    pub tool_name: String,
    pub tool_input: Value,
}

struct SessionState {
    socket_path: PathBuf,
    pending: Arc<Mutex<HashMap<String, UnixStream>>>,
    auto_allow: Arc<Mutex<bool>>,
}

#[derive(Default)]
pub struct PermissionBroker {
    sessions: Mutex<HashMap<String, SessionState>>,
}

impl PermissionBroker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get or create the per-session socket. Returns the absolute socket
    /// path that must be exposed to the claude hook via the
    /// `GLASSFORGE_PERM_SOCK` env var. Idempotent: calling it twice for the
    /// same session id reuses the existing listener and, crucially, the
    /// existing `auto_allow` flag — so "Allow session" persists across
    /// multiple `send_message` invocations.
    pub fn register(&self, app: &AppHandle, session_id: &str) -> Result<PathBuf> {
        {
            let guard = self
                .sessions
                .lock()
                .map_err(|_| anyhow!("broker lock poisoned"))?;
            if let Some(existing) = guard.get(session_id) {
                return Ok(existing.socket_path.clone());
            }
        }

        let dir = state_dir()?;
        std::fs::create_dir_all(&dir).ok();
        let socket_path = dir.join(format!("{session_id}.sock"));
        let _ = std::fs::remove_file(&socket_path);
        let listener =
            UnixListener::bind(&socket_path).context("failed to bind permission socket")?;

        let pending: Arc<Mutex<HashMap<String, UnixStream>>> = Arc::new(Mutex::new(HashMap::new()));
        let auto_allow = Arc::new(Mutex::new(false));

        {
            let mut guard = self
                .sessions
                .lock()
                .map_err(|_| anyhow!("broker lock poisoned"))?;
            guard.insert(
                session_id.to_string(),
                SessionState {
                    socket_path: socket_path.clone(),
                    pending: Arc::clone(&pending),
                    auto_allow: Arc::clone(&auto_allow),
                },
            );
        }

        let sid = session_id.to_string();
        let app2 = app.clone();
        let pending_for_thread = Arc::clone(&pending);
        let auto_allow_for_thread = Arc::clone(&auto_allow);
        thread::spawn(move || {
            for conn in listener.incoming() {
                let Ok(stream) = conn else { continue };
                handle_connection(
                    &sid,
                    &app2,
                    &pending_for_thread,
                    &auto_allow_for_thread,
                    stream,
                );
            }
        });

        Ok(socket_path)
    }

    pub fn resolve(&self, session_id: &str, request_id: &str, decision: Decision) -> Result<()> {
        let guard = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("broker lock poisoned"))?;
        let state = guard
            .get(session_id)
            .ok_or_else(|| anyhow!("session not registered with permission broker"))?;

        // Claude can emit multiple tool_use blocks in a single assistant
        // turn and spawn parallel hook subprocesses — each one parks its
        // own stream here. "Allow session" needs to unblock ALL of them,
        // not just the one the user clicked on, otherwise the remaining
        // parked hooks sit forever waiting.
        if matches!(decision, Decision::AllowSession) {
            *state
                .auto_allow
                .lock()
                .map_err(|_| anyhow!("auto_allow lock poisoned"))? = true;
            let mut pending = state
                .pending
                .lock()
                .map_err(|_| anyhow!("pending lock poisoned"))?;
            for (_, mut stream) in pending.drain() {
                stream.write_all(b"allow\n").ok();
            }
            return Ok(());
        }

        let mut pending = state
            .pending
            .lock()
            .map_err(|_| anyhow!("pending lock poisoned"))?;
        let mut stream = pending
            .remove(request_id)
            .ok_or_else(|| anyhow!("no pending request with id {request_id}"))?;
        let reply = match decision {
            Decision::Allow => "allow\n",
            Decision::Deny => "deny\n",
            Decision::AllowSession => unreachable!(),
        };
        stream.write_all(reply.as_bytes()).ok();
        Ok(())
    }

    pub fn unregister(&self, session_id: &str) {
        let Ok(mut guard) = self.sessions.lock() else {
            return;
        };
        if let Some(state) = guard.remove(session_id) {
            let _ = std::fs::remove_file(&state.socket_path);
        }
    }
}

fn handle_connection(
    session_id: &str,
    app: &AppHandle,
    pending: &Arc<Mutex<HashMap<String, UnixStream>>>,
    auto_allow: &Arc<Mutex<bool>>,
    stream: UnixStream,
) {
    let fast_allow = auto_allow.lock().map(|g| *g).unwrap_or(false);
    if fast_allow {
        let mut s = stream;
        let _ = s.write_all(b"allow\n");
        return;
    }

    let reader_stream = match stream.try_clone() {
        Ok(c) => c,
        Err(_) => return,
    };
    let mut reader = BufReader::new(reader_stream);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let parsed: Value = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(_) => {
            let mut s = stream;
            let _ = s.write_all(b"deny\n");
            return;
        }
    };
    let tool_name = parsed
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();
    let tool_input = parsed.get("tool_input").cloned().unwrap_or(Value::Null);
    let request_id = Uuid::new_v4().to_string();

    {
        let Ok(mut p) = pending.lock() else { return };
        p.insert(request_id.clone(), stream);
    }

    let req = PermissionRequest {
        session_id: session_id.to_string(),
        request_id,
        tool_name,
        tool_input,
    };
    let event = format!("session://{session_id}/permission_request");
    let _ = app.emit(&event, &req);
}

fn state_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| anyhow!("HOME not set"))?;
    Ok(PathBuf::from(home).join(".local/state/glassforge/sock"))
}

/// Absolute path where we drop the python hook on disk. The path is inside
/// the user's home so it's reachable both from the flatpak sandbox
/// (`--filesystem=home`) and from the host where claude actually runs.
pub fn hook_script_path() -> Result<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| anyhow!("HOME not set"))?;
    Ok(PathBuf::from(home).join(".local/share/glassforge/perm_hook.py"))
}

/// Write our bundled python hook to its home-dir location if missing or
/// stale. Idempotent.
pub fn ensure_hook_script() -> Result<PathBuf> {
    let path = hook_script_path()?;
    let parent = path.parent().ok_or_else(|| anyhow!("no parent"))?;
    std::fs::create_dir_all(parent).ok();
    let bundled = include_str!("perm_hook.py");
    let needs_write = match std::fs::read_to_string(&path) {
        Ok(existing) => existing != bundled,
        Err(_) => true,
    };
    if needs_write {
        std::fs::write(&path, bundled).context("failed to write perm_hook.py")?;
    }
    Ok(path)
}

/// Generate a settings.json containing a PreToolUse hook wired to the
/// python script. Written to a per-session temp file and passed via
/// `--settings`.
pub fn write_session_settings(session_id: &str, hook: &std::path::Path) -> Result<PathBuf> {
    let dir = state_dir()?.parent().unwrap().join("settings");
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join(format!("{session_id}.json"));
    let command = format!("python3 {}", hook.display());
    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": "*",
                    "hooks": [
                        { "type": "command", "command": command }
                    ]
                }
            ]
        }
    });
    std::fs::write(&path, serde_json::to_string_pretty(&settings)?)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_dir_uses_home() {
        let dir = state_dir().expect("HOME set in tests");
        assert!(dir.to_string_lossy().contains("glassforge"));
    }

    #[test]
    fn hook_script_path_is_under_home() {
        let p = hook_script_path().expect("HOME set");
        assert!(p.to_string_lossy().ends_with("perm_hook.py"));
    }
}
