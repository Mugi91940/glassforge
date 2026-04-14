//! Session lifecycle: spawn `claude`, attach a PTY, stream stdout,
//! route stdin, track status.
//!
//! A `SessionRegistry` owns all live sessions. Each session has its own
//! OS thread dedicated to blocking PTY reads; chunks are emitted on the
//! Tauri event bus as `session://{id}/stdout`, status transitions on
//! `session://{id}/status`, and the final exit code on `session://{id}/exit`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use portable_pty::{Child, ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Starting,
    Active,
    Idle,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub project_path: String,
    pub model: Option<String>,
    pub status: SessionStatus,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
struct StdoutChunk {
    data: String,
}

#[derive(Debug, Clone, Serialize)]
struct ExitPayload {
    code: Option<i32>,
    success: bool,
}

pub struct SessionHandle {
    info: Mutex<SessionInfo>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
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

type PtyBundle = (
    Box<dyn Read + Send>,
    Box<dyn Write + Send>,
    Box<dyn ChildKiller + Send + Sync>,
    Box<dyn Child + Send + Sync>,
);

/// Open a PTY and spawn `cmd` inside it. Returns the reader, writer,
/// a cloned killer, and the child handle (for `wait()`). Exposed at
/// crate level so tests can exercise the PTY path without needing
/// a Tauri `AppHandle`.
fn spawn_pty(cmd: CommandBuilder) -> Result<PtyBundle> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open pty")?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .context("failed to spawn command in pty")?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .context("failed to clone pty reader")?;
    let writer = pair
        .master
        .take_writer()
        .context("failed to take pty writer")?;
    let killer = child.clone_killer();

    Ok((reader, writer, killer, child))
}

fn build_claude_command(project_path: &PathBuf, model: Option<&str>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("claude");
    if let Some(m) = model {
        cmd.args(["--model", m]);
    }
    cmd.cwd(project_path);
    // PTY command builders start with an empty environment; inherit the
    // parent process env so `claude` can read `$HOME`, `$PATH`, and its
    // own auth files.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    cmd
}

pub fn create_session(
    registry: &Arc<SessionRegistry>,
    app: AppHandle,
    project_path: String,
    model: Option<String>,
) -> Result<SessionInfo> {
    let path = PathBuf::from(&project_path);
    if !path.is_dir() {
        return Err(anyhow!("project_path is not a directory: {}", project_path));
    }

    let cmd = build_claude_command(&path, model.as_deref());
    let (reader, writer, killer, child) = spawn_pty(cmd)?;

    let id = Uuid::now_v7().to_string();
    let info = SessionInfo {
        id: id.clone(),
        project_path,
        model,
        status: SessionStatus::Starting,
        created_at: now_secs(),
    };

    let handle = Arc::new(SessionHandle {
        info: Mutex::new(info.clone()),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
    });

    registry.insert(id.clone(), handle.clone());

    let reader_app = app.clone();
    let reader_id = id.clone();
    let reader_handle = handle.clone();
    let reader_registry = registry.clone();

    thread::Builder::new()
        .name(format!("glassforge-pty-{id}"))
        .spawn(move || {
            read_loop(
                reader_app,
                reader_id,
                reader,
                child,
                reader_handle,
                reader_registry,
            );
        })
        .context("failed to spawn pty reader thread")?;

    Ok(info)
}

fn read_loop(
    app: AppHandle,
    id: String,
    mut reader: Box<dyn Read + Send>,
    mut child: Box<dyn Child + Send + Sync>,
    handle: Arc<SessionHandle>,
    registry: Arc<SessionRegistry>,
) {
    let stdout_event = format!("session://{id}/stdout");
    let status_event = format!("session://{id}/status");
    let exit_event = format!("session://{id}/exit");

    set_status(&handle, SessionStatus::Active);
    let _ = app.emit(&status_event, SessionStatus::Active);

    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                let _ = app.emit(&stdout_event, StdoutChunk { data: chunk });
            }
            Err(e) => {
                log::warn!("pty read error on session {id}: {e}");
                set_status(&handle, SessionStatus::Error);
                let _ = app.emit(&status_event, SessionStatus::Error);
                break;
            }
        }
    }

    let status = child.wait().ok();
    let code = status.map(|s| s.exit_code() as i32);
    let success = code == Some(0);

    set_status(&handle, SessionStatus::Done);
    let _ = app.emit(&status_event, SessionStatus::Done);
    let _ = app.emit(&exit_event, ExitPayload { code, success });

    registry.remove(&id);
}

fn set_status(handle: &SessionHandle, status: SessionStatus) {
    if let Ok(mut info) = handle.info.lock() {
        info.status = status;
    }
}

pub fn send_message(registry: &SessionRegistry, id: &str, message: &str) -> Result<()> {
    let handle = registry
        .get(id)
        .ok_or_else(|| anyhow!("session not found: {id}"))?;
    let mut writer = handle
        .writer
        .lock()
        .map_err(|_| anyhow!("writer lock poisoned"))?;
    writer
        .write_all(message.as_bytes())
        .context("failed to write to pty")?;
    if !message.ends_with('\n') {
        writer.write_all(b"\n").context("failed to write newline")?;
    }
    writer.flush().context("failed to flush pty")?;
    Ok(())
}

pub fn kill_session(registry: &SessionRegistry, id: &str) -> Result<()> {
    let handle = registry
        .get(id)
        .ok_or_else(|| anyhow!("session not found: {id}"))?;
    let mut killer = handle
        .killer
        .lock()
        .map_err(|_| anyhow!("killer lock poisoned"))?;
    killer.kill().context("failed to kill child")?;
    Ok(())
}

pub fn list_sessions(registry: &SessionRegistry) -> Vec<SessionInfo> {
    registry.list()
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
            serde_json::to_string(&SessionStatus::Active).unwrap(),
            "\"active\""
        );
        assert_eq!(
            serde_json::to_string(&SessionStatus::Done).unwrap(),
            "\"done\""
        );
    }

    #[test]
    fn now_secs_is_non_zero() {
        assert!(now_secs() > 0);
    }

    #[test]
    fn build_claude_command_includes_model_flag() {
        let cb = build_claude_command(&PathBuf::from("/tmp"), Some("sonnet"));
        let dbg = format!("{cb:?}");
        assert!(dbg.contains("claude"));
        assert!(dbg.contains("--model"));
        assert!(dbg.contains("sonnet"));
    }

    /// End-to-end PTY round-trip using `/bin/cat`: write a line, expect
    /// it echoed back. Verifies spawn, reader, writer, and killer.
    #[cfg(unix)]
    #[test]
    fn pty_roundtrip_with_cat() {
        use std::io::Read;
        use std::time::Duration;

        let mut cmd = CommandBuilder::new("/bin/cat");
        cmd.cwd(std::env::temp_dir());
        for (k, v) in std::env::vars() {
            cmd.env(k, v);
        }

        let (mut reader, mut writer, mut killer, mut child) =
            spawn_pty(cmd).expect("spawn /bin/cat");

        writer.write_all(b"glassforge\n").unwrap();
        writer.flush().unwrap();

        // Read until we see our marker or give up after a bounded number
        // of attempts. `cat` in a PTY echoes input + outputs it again.
        let mut buf = [0u8; 256];
        let mut collected = String::new();
        for _ in 0..20 {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    collected.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if collected.contains("glassforge") {
                        break;
                    }
                }
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }

        assert!(
            collected.contains("glassforge"),
            "pty roundtrip failed, got: {collected:?}"
        );

        killer.kill().ok();
        let _ = child.wait();
    }
}
