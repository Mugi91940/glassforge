// src-tauri/src/voice/mod.rs
pub mod commands;

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum SidecarEvent {
    Ready,
    Transcript { text: String, r#final: bool },
    SpeakDone,
    Error { message: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum SidecarCmd {
    StartListen,
    StopListen,
    Speak { text: String, lang: String },
    SetModel { model: String },
    Shutdown,
}

pub struct VoiceSidecar {
    stdin: Arc<Mutex<ChildStdin>>,
    _child: Child,
}

impl VoiceSidecar {
    pub fn spawn(app: AppHandle, sidecar_path: &str) -> anyhow::Result<Self> {
        // Prefer venv python next to the sidecar script
        let venv_python = std::path::Path::new(sidecar_path)
            .parent()
            .map(|d| d.join(".venv/bin/python3"))
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "python3".to_string());

        let mut child = std::process::Command::new(&venv_python)
            .arg(sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(if cfg!(debug_assertions) { Stdio::inherit() } else { Stdio::null() })
            .spawn()?;

        let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        let stdout: ChildStdout = child.stdout.take().unwrap();

        let app_clone = app.clone();

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                match serde_json::from_str::<SidecarEvent>(&line) {
                    Ok(event) => {
                        let _ = app_clone.emit("voice://event", &event);
                        if matches!(event, SidecarEvent::Ready) {
                            log::info!("voice sidecar ready");
                        }
                    }
                    Err(e) => {
                        log::warn!("voice sidecar unknown line: {:?} ({e})", line);
                    }
                }
            }
        });

        Ok(Self { stdin, _child: child })
    }

    pub fn send(&self, cmd: &SidecarCmd) -> anyhow::Result<()> {
        let mut guard = self.stdin.lock().unwrap();
        let line = serde_json::to_string(cmd)?;
        writeln!(guard, "{}", line)?;
        Ok(())
    }
}

impl Drop for VoiceSidecar {
    fn drop(&mut self) {
        let cmd = SidecarCmd::Shutdown;
        if let Ok(mut guard) = self.stdin.lock() {
            if let Ok(line) = serde_json::to_string(&cmd) {
                let _ = writeln!(*guard, "{}", line);
            }
        }
        let _ = self._child.kill();
        let _ = self._child.wait();
    }
}

pub struct VoiceState {
    pub sidecar: Mutex<Option<VoiceSidecar>>,
    pub listening: Mutex<bool>,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            sidecar: Mutex::new(None),
            listening: Mutex::new(false),
        }
    }
}

impl VoiceState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_cmd_serializes_correctly() {
        let cmd = SidecarCmd::Speak {
            text: "bonjour".to_string(),
            lang: "fr".to_string(),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"cmd\":\"speak\""));
        assert!(json.contains("\"text\":\"bonjour\""));
    }

    #[test]
    fn sidecar_event_deserializes_transcript() {
        let json = r#"{"event":"transcript","text":"hello","final":true}"#;
        let event: SidecarEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, SidecarEvent::Transcript { r#final: true, .. }));
    }
}
