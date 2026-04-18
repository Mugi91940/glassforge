# Voice Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une commande vocale à GlassForge activée par Super+V — transcription faster-whisper, réponse piper-tts, et fenêtre HUD flottante top-center.

**Architecture:** Un sidecar Python (`src-tauri/sidecar/voice_sidecar.py`) reste en mémoire et gère le micro, faster-whisper, et piper-tts via un protocole JSON sur stdin/stdout. Rust le spawn au démarrage et l'expose via des commandes Tauri. La fenêtre HUD est la fenêtre `main` de GlassForge qui détecte son label et rend un composant différent.

**Tech Stack:** Python 3 + faster-whisper + piper-tts + sounddevice, Rust + tokio + tauri-plugin-global-shortcut, React + Zustand, Tauri 2.

---

## Fichiers créés / modifiés

| Fichier | Action | Rôle |
|---|---|---|
| `src-tauri/sidecar/voice_sidecar.py` | Créer | Sidecar Python : micro → whisper → piper |
| `src-tauri/sidecar/requirements.txt` | Créer | Dépendances pip |
| `src-tauri/src/voice/mod.rs` | Créer | Module voice : spawn sidecar, protocole JSON |
| `src-tauri/src/voice/commands.rs` | Créer | Commandes Tauri voice + détection commandes système |
| `src-tauri/src/lib.rs` | Modifier | Enregistrer plugin global-shortcut + mod voice |
| `src-tauri/Cargo.toml` | Modifier | Ajouter tauri-plugin-global-shortcut |
| `src-tauri/tauri.conf.json` | Modifier | Ajouter fenêtre HUD (label: "voice-hud") |
| `src/main.tsx` | Modifier | Router vers VoiceHud si window label = "voice-hud" |
| `src/voice-hud/VoiceHud.tsx` | Créer | Composant React HUD |
| `src/voice-hud/VoiceHud.module.css` | Créer | Styles glass HUD |
| `src/stores/voiceStore.ts` | Créer | Zustand store : état voice (écoute / transcription / réponse) |
| `src/stores/preferencesStore.ts` | Modifier | Ajouter voicePrefs (shortcut, model, lang, tts, autoSpeak, hudDuration) |
| `src/components/settings/VoiceEditor.tsx` | Créer | Onglet "Voice" dans Settings |
| `src/components/settings/SettingsPanel.tsx` | Modifier | Ajouter VoiceEditor dans le body |

---

## Task 1 : Sidecar Python

**Files:**
- Create: `src-tauri/sidecar/voice_sidecar.py`
- Create: `src-tauri/sidecar/requirements.txt`

- [ ] **Step 1 : Créer requirements.txt**

```
faster-whisper>=1.0.0
piper-tts>=1.2.0
sounddevice>=0.4.6
numpy>=1.24.0
```

- [ ] **Step 2 : Créer voice_sidecar.py**

```python
#!/usr/bin/env python3
"""
Voice sidecar for GlassForge.
Reads JSON commands from stdin, writes JSON events to stdout.

Commands (stdin, one JSON per line):
  {"cmd": "start_listen"}
  {"cmd": "stop_listen"}
  {"cmd": "speak", "text": "...", "lang": "fr"}
  {"cmd": "set_model", "model": "base"}
  {"cmd": "shutdown"}

Events (stdout, one JSON per line):
  {"event": "ready"}
  {"event": "transcript", "text": "...", "final": false}
  {"event": "transcript", "text": "...", "final": true}
  {"event": "speak_done"}
  {"event": "error", "message": "..."}
"""

import json
import sys
import threading
import queue
import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000
CHANNELS = 1
BLOCK_SIZE = 1024
SILENCE_THRESHOLD = 0.01
SILENCE_SECONDS = 1.5


def emit(event: dict):
    print(json.dumps(event), flush=True)


def load_whisper(model_name: str):
    from faster_whisper import WhisperModel
    return WhisperModel(model_name, device="cpu", compute_type="int8")


class VoiceSidecar:
    def __init__(self):
        self.model = None
        self.model_name = "base"
        self.listening = False
        self.audio_queue: queue.Queue = queue.Queue()
        self.listen_thread: threading.Thread | None = None
        self.piper_voice = None

    def set_model(self, model_name: str):
        self.model_name = model_name
        self.model = load_whisper(model_name)

    def ensure_model(self):
        if self.model is None:
            self.model = load_whisper(self.model_name)

    def start_listen(self):
        if self.listening:
            return
        self.listening = True
        self.audio_queue = queue.Queue()
        self.listen_thread = threading.Thread(
            target=self._record_and_transcribe, daemon=True
        )
        self.listen_thread.start()

    def stop_listen(self):
        self.listening = False

    def _audio_callback(self, indata, frames, time, status):
        if self.listening:
            self.audio_queue.put(indata.copy())

    def _record_and_transcribe(self):
        self.ensure_model()
        chunks = []
        silence_frames = 0
        silence_limit = int(SILENCE_SECONDS * SAMPLE_RATE / BLOCK_SIZE)

        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            blocksize=BLOCK_SIZE,
            callback=self._audio_callback,
        ):
            while self.listening or not self.audio_queue.empty():
                try:
                    chunk = self.audio_queue.get(timeout=0.1)
                except queue.Empty:
                    continue

                chunks.append(chunk)
                rms = float(np.sqrt(np.mean(chunk ** 2)))

                if rms < SILENCE_THRESHOLD:
                    silence_frames += 1
                else:
                    silence_frames = 0

                # Stream partial transcript every ~2 seconds of audio
                if len(chunks) % 32 == 0 and len(chunks) > 0:
                    audio = np.concatenate(chunks).flatten()
                    segs, _ = self.model.transcribe(audio, language=None)
                    partial = " ".join(s.text for s in segs).strip()
                    if partial:
                        emit({"event": "transcript", "text": partial, "final": False})

                if silence_frames >= silence_limit and not self.listening:
                    break

        if chunks:
            audio = np.concatenate(chunks).flatten()
            segs, _ = self.model.transcribe(audio, language=None)
            text = " ".join(s.text for s in segs).strip()
            emit({"event": "transcript", "text": text, "final": True})

    def speak(self, text: str, lang: str = "fr"):
        try:
            from piper.voice import PiperVoice
            import wave, io, subprocess

            # Detect first available piper model in ~/.local/share/piper/
            import glob as _glob, os as _os
            model_dir = _os.path.expanduser("~/.local/share/piper/")
            models = _glob.glob(f"{model_dir}*.onnx")
            model_path = models[0] if models else f"{model_dir}fr_FR-upmc-medium.onnx"
            proc = subprocess.run(
                ["piper", "--model", model_path, "--output-raw"],
                input=text.encode(),
                capture_output=True,
            )
            if proc.returncode == 0:
                audio = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
                sd.play(audio, samplerate=22050, blocking=True)
            emit({"event": "speak_done"})
        except Exception as e:
            emit({"event": "error", "message": f"speak failed: {e}"})

    def run(self):
        emit({"event": "ready"})
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError:
                continue

            name = cmd.get("cmd")
            if name == "start_listen":
                self.start_listen()
            elif name == "stop_listen":
                self.stop_listen()
            elif name == "speak":
                text = cmd.get("text", "")
                lang = cmd.get("lang", "fr")
                threading.Thread(
                    target=self.speak, args=(text, lang), daemon=True
                ).start()
            elif name == "set_model":
                self.set_model(cmd.get("model", "base"))
            elif name == "shutdown":
                self.stop_listen()
                break


if __name__ == "__main__":
    VoiceSidecar().run()
```

- [ ] **Step 3 : Tester le sidecar standalone**

```bash
cd /home/mugi/GitHub/glassforge
pip install faster-whisper piper-tts sounddevice numpy
echo '{"cmd": "shutdown"}' | python3 src-tauri/sidecar/voice_sidecar.py
```

Résultat attendu : `{"event": "ready"}` puis le processus se termine proprement.

- [ ] **Step 4 : Commit**

```bash
git add src-tauri/sidecar/
git commit -m "feat(voice): add Python sidecar (faster-whisper + piper-tts)"
```

---

## Task 2 : Module Rust — gestion du sidecar

**Files:**
- Create: `src-tauri/src/voice/mod.rs`

- [ ] **Step 1 : Créer le répertoire et mod.rs**

```rust
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
        let mut child = std::process::Command::new("python3")
            .arg(sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;

        let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        let stdout: ChildStdout = child.stdout.take().unwrap();

        let stdin_clone = Arc::clone(&stdin);
        let app_clone = app.clone();

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if let Ok(event) = serde_json::from_str::<SidecarEvent>(&line) {
                    let _ = app_clone.emit("voice://event", &event);
                    // On ready, emit a specific event
                    if matches!(event, SidecarEvent::Ready) {
                        log::info!("voice sidecar ready");
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

pub struct VoiceState {
    pub sidecar: Mutex<Option<VoiceSidecar>>,
    pub listening: Mutex<bool>,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            sidecar: Mutex::new(None),
            listening: Mutex::new(false),
        }
    }
}
```

- [ ] **Step 2 : Écrire un test unitaire pour SidecarCmd serde**

Ajouter à la fin de `src-tauri/src/voice/mod.rs` :

```rust
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
```

- [ ] **Step 3 : Lancer les tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml voice
```

Résultat attendu : 2 tests passent.

- [ ] **Step 4 : Commit**

```bash
git add src-tauri/src/voice/
git commit -m "feat(voice): Rust voice module — sidecar process management"
```

---

## Task 3 : Commandes Tauri voice + détection commandes système

**Files:**
- Create: `src-tauri/src/voice/commands.rs`

- [ ] **Step 1 : Créer commands.rs**

```rust
// src-tauri/src/voice/commands.rs
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::voice::{SidecarCmd, VoiceState};

type VoiceStateRef<'r> = State<'r, Arc<VoiceState>>;

#[tauri::command]
pub fn voice_start_listen(state: VoiceStateRef<'_>) -> Result<(), String> {
    let guard = state.sidecar.lock().unwrap();
    if let Some(sc) = guard.as_ref() {
        sc.send(&SidecarCmd::StartListen).map_err(|e| e.to_string())?;
        drop(guard);
        *state.listening.lock().unwrap() = true;
        Ok(())
    } else {
        Err("voice sidecar not running".into())
    }
}

#[tauri::command]
pub fn voice_stop_listen(state: VoiceStateRef<'_>) -> Result<(), String> {
    let guard = state.sidecar.lock().unwrap();
    if let Some(sc) = guard.as_ref() {
        sc.send(&SidecarCmd::StopListen).map_err(|e| e.to_string())?;
        drop(guard);
        *state.listening.lock().unwrap() = false;
        Ok(())
    } else {
        Err("voice sidecar not running".into())
    }
}

#[tauri::command]
pub fn voice_speak(state: VoiceStateRef<'_>, text: String, lang: String) -> Result<(), String> {
    let guard = state.sidecar.lock().unwrap();
    if let Some(sc) = guard.as_ref() {
        sc.send(&SidecarCmd::Speak { text, lang })
            .map_err(|e| e.to_string())
    } else {
        Err("voice sidecar not running".into())
    }
}

#[tauri::command]
pub fn voice_set_model(
    state: VoiceStateRef<'_>,
    model: String,
) -> Result<(), String> {
    let guard = state.sidecar.lock().unwrap();
    if let Some(sc) = guard.as_ref() {
        sc.send(&SidecarCmd::SetModel { model })
            .map_err(|e| e.to_string())
    } else {
        Err("voice sidecar not running".into())
    }
}

#[tauri::command]
pub fn voice_is_listening(state: VoiceStateRef<'_>) -> bool {
    *state.listening.lock().unwrap()
}

/// Returns the GlassForge system command triggered by the phrase, or None.
/// Called from the frontend after receiving a final transcript.
#[tauri::command]
pub fn voice_detect_command(text: String) -> Option<String> {
    let t = text.to_lowercase();
    let t = t.trim();
    if t.contains("nouvelle session") {
        Some("new_session".into())
    } else if t.contains("ferme la session") || t.contains("fermer la session") {
        Some("close_session".into())
    } else if t.contains("session suivante") {
        Some("next_session".into())
    } else if t.contains("session précédente") || t.contains("session precedente") {
        Some("prev_session".into())
    } else if t.contains("copie la réponse") || t.contains("copier la réponse") {
        Some("copy_response".into())
    } else if t == "arrête" || t == "arrete" || t == "stop" {
        Some("stop_speak".into())
    } else {
        None
    }
}
```

- [ ] **Step 2 : Écrire des tests pour voice_detect_command**

Ajouter à la fin de `src-tauri/src/voice/commands.rs` :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_new_session() {
        assert_eq!(voice_detect_command("Nouvelle session".into()), Some("new_session".into()));
    }

    #[test]
    fn detects_close_session() {
        assert_eq!(voice_detect_command("Ferme la session".into()), Some("close_session".into()));
    }

    #[test]
    fn returns_none_for_message() {
        assert_eq!(voice_detect_command("Explique-moi ce bug".into()), None);
    }

    #[test]
    fn detects_copy_response() {
        assert_eq!(
            voice_detect_command("copie la réponse".into()),
            Some("copy_response".into()),
        );
    }
}
```

- [ ] **Step 3 : Lancer les tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml voice_detect
```

Résultat attendu : 4 tests passent.

- [ ] **Step 4 : Commit**

```bash
git add src-tauri/src/voice/commands.rs
git commit -m "feat(voice): Tauri commands + system command detection"
```

---

## Task 4 : Cargo.toml + lib.rs — plugin global-shortcut + voice module

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1 : Ajouter tauri-plugin-global-shortcut à Cargo.toml**

Dans la section `[dependencies]` de `src-tauri/Cargo.toml`, ajouter :

```toml
tauri-plugin-global-shortcut = "2"
```

- [ ] **Step 2 : Modifier lib.rs — ajouter mod voice, VoiceState, plugin, shortcut, et commandes**

En haut de `src-tauri/src/lib.rs`, ajouter après les `mod` existants :
```rust
mod voice;
```

Après `use skills::Skill;`, ajouter :
```rust
use voice::VoiceState;
use voice::commands::{
    voice_detect_command, voice_is_listening, voice_set_model,
    voice_speak, voice_start_listen, voice_stop_listen,
};
```

Ajouter `VoiceStateRef` dans les type aliases :
```rust
type VoiceStateRef<'r> = State<'r, Arc<VoiceState>>;
```

Dans `pub fn run()`, ajouter le plugin dans la chaîne `.plugin(...)` :
```rust
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

Ajouter `.manage(Arc::new(VoiceState::new()))` après les autres `.manage(...)`.

Dans le bloc `.setup(|app| { ... })`, avant `Ok(())`, ajouter le spawn du sidecar et l'enregistrement du raccourci :

```rust
// Spawn voice sidecar
{
    use tauri::Manager;
    let sidecar_path = app.path()
        .resource_dir()
        .unwrap_or_default()
        .join("sidecar")
        .join("voice_sidecar.py");
    let sidecar_path_str = sidecar_path.to_string_lossy().to_string();
    let voice_state = app.state::<Arc<VoiceState>>();
    match voice::VoiceSidecar::spawn(app.handle().clone(), &sidecar_path_str) {
        Ok(sc) => {
            *voice_state.sidecar.lock().unwrap() = Some(sc);
            log::info!("voice sidecar spawned from {}", sidecar_path_str);
        }
        Err(e) => log::warn!("voice sidecar failed to spawn: {e}"),
    }
}

// Register Super+V global shortcut
{
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};
    let shortcut = tauri_plugin_global_shortcut::Shortcut::new(
        Some(Modifiers::SUPER),
        Code::KeyV,
    );
    app.handle().global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            let _ = app.emit("voice://toggle", ());
        }
    })?;
}
```

Dans `invoke_handler`, ajouter les nouvelles commandes :
```rust
voice_start_listen,
voice_stop_listen,
voice_speak,
voice_set_model,
voice_is_listening,
voice_detect_command,
```

- [ ] **Step 3 : Compiler pour vérifier**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | head -40
```

Résultat attendu : compilation réussie (0 erreur).

- [ ] **Step 4 : Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat(voice): register global shortcut Super+V + spawn sidecar at startup"
```

---

## Task 5 : Fenêtre HUD — tauri.conf.json

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1 : Ajouter la fenêtre HUD dans tauri.conf.json**

Dans le tableau `"windows"`, ajouter après la fenêtre `"main"` :

```json
{
  "title": "GlassForge Voice",
  "label": "voice-hud",
  "width": 440,
  "height": 130,
  "minWidth": 440,
  "minHeight": 130,
  "maxWidth": 440,
  "maxHeight": 130,
  "transparent": true,
  "decorations": false,
  "resizable": false,
  "alwaysOnTop": true,
  "visible": false,
  "center": false,
  "x": 0,
  "y": 20,
  "skipTaskbar": true
}
```

- [ ] **Step 2 : Vérifier que la config est valide**

```bash
cat src-tauri/tauri.conf.json | python3 -c "import json,sys; json.load(sys.stdin); print('JSON valid')"
```

Résultat attendu : `JSON valid`

- [ ] **Step 3 : Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(voice): add voice-hud window to tauri config"
```

---

## Task 6 : Voice Zustand store

**Files:**
- Create: `src/stores/voiceStore.ts`

- [ ] **Step 1 : Créer voiceStore.ts**

```typescript
// src/stores/voiceStore.ts
import { create } from "zustand";

export type VoicePhase = "idle" | "listening" | "processing" | "speaking";

type VoiceState = {
  phase: VoicePhase;
  transcript: string;
  response: string;
  setPhase: (phase: VoicePhase) => void;
  setTranscript: (text: string) => void;
  setResponse: (text: string) => void;
  reset: () => void;
};

export const useVoiceStore = create<VoiceState>((set) => ({
  phase: "idle",
  transcript: "",
  response: "",
  setPhase: (phase) => set({ phase }),
  setTranscript: (transcript) => set({ transcript }),
  setResponse: (response) => set({ response }),
  reset: () => set({ phase: "idle", transcript: "", response: "" }),
}));
```

- [ ] **Step 2 : Vérifier le typage**

```bash
pnpm typecheck
```

Résultat attendu : 0 erreur TypeScript.

- [ ] **Step 3 : Commit**

```bash
git add src/stores/voiceStore.ts
git commit -m "feat(voice): add Zustand voice store"
```

---

## Task 7 : Composant HUD React

**Files:**
- Create: `src/voice-hud/VoiceHud.tsx`
- Create: `src/voice-hud/VoiceHud.module.css`

- [ ] **Step 1 : Créer VoiceHud.module.css**

```css
/* src/voice-hud/VoiceHud.module.css */
.hud {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 14px;
  background: rgba(12, 12, 24, 0.88);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.04);
  user-select: none;
  overflow: hidden;
}

.icon {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s;
}

.icon[data-phase="listening"] {
  background: rgba(120, 100, 255, 0.2);
  border: 2px solid rgba(120, 100, 255, 0.7);
  animation: pulse 1.5s ease-in-out infinite;
}

.icon[data-phase="processing"] {
  background: rgba(255, 80, 80, 0.2);
  border: 2px solid rgba(255, 80, 80, 0.7);
}

.icon[data-phase="speaking"] {
  background: rgba(40, 200, 120, 0.2);
  border: 2px solid rgba(40, 200, 120, 0.6);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  opacity: 0.6;
}

.label[data-phase="listening"] { color: rgba(160, 140, 255, 1); }
.label[data-phase="processing"] { color: rgba(255, 100, 100, 1); }
.label[data-phase="speaking"] { color: rgba(60, 220, 140, 1); }

.transcript {
  font-size: 13px;
  color: rgba(220, 220, 240, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.response {
  font-size: 12px;
  color: rgba(180, 180, 200, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shortcut {
  font-size: 10px;
  color: rgba(200, 200, 220, 0.25);
  flex-shrink: 0;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(120, 100, 255, 0.5); }
  50%       { box-shadow: 0 0 0 8px rgba(120, 100, 255, 0); }
}
```

- [ ] **Step 2 : Créer VoiceHud.tsx**

```tsx
// src/voice-hud/VoiceHud.tsx
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Mic, Circle, Volume2 } from "lucide-react";

import { useVoiceStore, type VoicePhase } from "@/stores/voiceStore";
import styles from "./VoiceHud.module.css";

const LABELS: Record<VoicePhase, string> = {
  idle: "En veille",
  listening: "Écoute...",
  processing: "Enregistrement",
  speaking: "Réponse vocale",
};

export function VoiceHud() {
  const phase = useVoiceStore((s) => s.phase);
  const transcript = useVoiceStore((s) => s.transcript);
  const response = useVoiceStore((s) => s.response);
  const setPhase = useVoiceStore((s) => s.setPhase);
  const setTranscript = useVoiceStore((s) => s.setTranscript);
  const setResponse = useVoiceStore((s) => s.setResponse);
  const reset = useVoiceStore((s) => s.reset);

  useEffect(() => {
    const win = getCurrentWebviewWindow();

    // Listen for voice events from Rust sidecar
    const unlisten = listen<{ event: string; text?: string; final?: boolean; message?: string }>(
      "voice://event",
      ({ payload }) => {
        if (payload.event === "transcript") {
          setTranscript(payload.text ?? "");
          if (payload.final) {
            setPhase("processing");
            void handleFinalTranscript(payload.text ?? "");
          } else {
            setPhase("processing");
          }
        } else if (payload.event === "speak_done") {
          setTimeout(() => {
            reset();
            void win.hide();
          }, 3000);
        }
      },
    );

    // Listen for toggle signal from main window
    const unlistenToggle = listen("voice://toggle", async () => {
      const isListening = await invoke<boolean>("voice_is_listening");
      if (isListening) {
        await invoke("voice_stop_listen");
        setPhase("idle");
      } else {
        // Position the window top-center before showing
        await positionTopCenter(win);
        await win.show();
        await win.setFocus();
        await invoke("voice_start_listen");
        setPhase("listening");
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
      void unlistenToggle.then((fn) => fn());
    };
  }, [setPhase, setTranscript, setResponse, reset]);

  return (
    <div className={styles.hud}>
      <div className={styles.icon} data-phase={phase}>
        {phase === "listening" && <Mic size={16} color="rgba(160,140,255,1)" />}
        {phase === "processing" && <Circle size={10} color="rgba(255,100,100,1)" fill="rgba(255,100,100,0.9)" />}
        {phase === "speaking" && <Volume2 size={16} color="rgba(60,220,140,1)" />}
        {phase === "idle" && <Mic size={16} color="rgba(200,200,220,0.3)" />}
      </div>

      <div className={styles.text}>
        <div className={styles.label} data-phase={phase}>
          {LABELS[phase]}
        </div>
        {transcript && (
          <div className={styles.transcript}>{transcript}</div>
        )}
        {response && phase === "speaking" && (
          <div className={styles.response}>{response}</div>
        )}
      </div>

      <div className={styles.shortcut}>Super+V</div>
    </div>
  );
}

async function positionTopCenter(win: Awaited<ReturnType<typeof getCurrentWebviewWindow>>) {
  try {
    const monitor = await win.currentMonitor();
    if (!monitor) return;
    const screenW = monitor.size.width;
    const windowW = 440;
    const x = Math.floor((screenW - windowW) / 2);
    await win.setPosition({ type: "Physical", x, y: 20 } as never);
  } catch {
    // ignore positioning errors
  }
}

async function handleFinalTranscript(text: string) {
  const { setPhase, setResponse } = useVoiceStore.getState();

  // Detect system command
  const command = await invoke<string | null>("voice_detect_command", { text });
  if (command) {
    // Dispatch to main window
    const { emit } = await import("@tauri-apps/api/event");
    await emit("voice://command", { command });
    const label = commandLabel(command);
    setResponse(label);
    setPhase("speaking");
    await invoke("voice_speak", { text: label, lang: "fr" });
  } else {
    // Send text to active Claude session via main window
    const { emit } = await import("@tauri-apps/api/event");
    await emit("voice://send_message", { text });
    setResponse("Message envoyé à Claude");
    setPhase("speaking");
    // Claude response will be TTS'd by the main window listener
  }
}

function commandLabel(cmd: string): string {
  const labels: Record<string, string> = {
    new_session: "Nouvelle session créée.",
    close_session: "Session fermée.",
    next_session: "Session suivante.",
    prev_session: "Session précédente.",
    copy_response: "Réponse copiée.",
    stop_speak: "Arrêt de la lecture.",
  };
  return labels[cmd] ?? "Commande exécutée.";
}
```

- [ ] **Step 3 : Vérifier le typage**

```bash
pnpm typecheck
```

Résultat attendu : 0 erreur TypeScript.

- [ ] **Step 4 : Commit**

```bash
git add src/voice-hud/
git commit -m "feat(voice): HUD React component + CSS glass styles"
```

---

## Task 8 : main.tsx — routing vers VoiceHud + écoute des events voice

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1 : Lire le contenu actuel de main.tsx**

```bash
cat src/main.tsx
```

- [ ] **Step 2 : Modifier main.tsx pour router selon le label de fenêtre**

Remplacer le contenu de `src/main.tsx` par :

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import "@/styles/global.css";
import "@/styles/theme.css";

async function boot() {
  const win = getCurrentWebviewWindow();
  const root = document.getElementById("root")!;

  if (win.label === "voice-hud") {
    const { VoiceHud } = await import("@/voice-hud/VoiceHud");
    createRoot(root).render(
      <StrictMode>
        <VoiceHud />
      </StrictMode>,
    );
    return;
  }

  // Main app — also listen for voice events that need main-window context
  const { App } = await import("./App");
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Handle voice commands dispatched from HUD
  listen<{ command: string }>("voice://command", ({ payload }) => {
    window.dispatchEvent(new CustomEvent("voice:command", { detail: payload.command }));
  });

  // Handle Claude message from voice dictation
  listen<{ text: string }>("voice://send_message", ({ payload }) => {
    window.dispatchEvent(new CustomEvent("voice:send_message", { detail: payload.text }));
  });
}

void boot();
```

- [ ] **Step 3 : Vérifier le typage**

```bash
pnpm typecheck
```

Résultat attendu : 0 erreur TypeScript.

- [ ] **Step 4 : Commit**

```bash
git add src/main.tsx
git commit -m "feat(voice): route voice-hud window + relay voice events in main window"
```

---

## Task 9 : Écoute des commandes vocales dans App.tsx / useKeyboardShortcuts

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1 : Ajouter l'écoute des voice:command dans useKeyboardShortcuts**

Dans `useKeyboardShortcuts.ts`, dans le `useEffect`, après la déclaration de `handler`, ajouter :

```typescript
function voiceCommandHandler(e: Event) {
  const command = (e as CustomEvent<string>).detail;
  switch (command) {
    case "new_session": {
      const lastPath = projects[0]?.path;
      if (lastPath) {
        createSession(lastPath, null)
          .then((info) => {
            addSession(info);
            setActive(info.id);
            void touch(lastPath);
          })
          .catch((err) => log.error("voice new_session failed", String(err)));
      }
      break;
    }
    case "next_session":
      if (order.length > 1) {
        const idx = activeId ? order.indexOf(activeId) : -1;
        setActive(order[idx >= order.length - 1 ? 0 : idx + 1]);
      }
      break;
    case "prev_session":
      if (order.length > 1) {
        const idx = activeId ? order.indexOf(activeId) : -1;
        setActive(order[idx <= 0 ? order.length - 1 : idx - 1]);
      }
      break;
    case "close_session":
      if (activeId) {
        void import("@/lib/tauri-commands").then(({ killSession }) =>
          killSession(activeId),
        );
      }
      break;
    case "copy_response": {
      // Copy the last assistant message from the active session's chat
      const lastMsg = document.querySelector(
        "[data-role='assistant']:last-of-type",
      );
      if (lastMsg?.textContent) {
        void navigator.clipboard.writeText(lastMsg.textContent);
      }
      break;
    }
    case "stop_speak":
      // Ask sidecar to cut audio playback by restarting sounddevice stream
      void invoke("voice_speak", { text: "", lang: "fr" });
      break;
  }
}

window.addEventListener("voice:command", voiceCommandHandler);
```

Et dans le cleanup du `useEffect` :
```typescript
window.removeEventListener("voice:command", voiceCommandHandler);
```

- [ ] **Step 2 : Vérifier le typage**

```bash
pnpm typecheck
```

Résultat attendu : 0 erreur TypeScript.

- [ ] **Step 3 : Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(voice): handle voice commands in keyboard shortcuts hook"
```

---

## Task 10 : Préférences voix + onglet Settings

**Files:**
- Modify: `src/stores/preferencesStore.ts`
- Create: `src/components/settings/VoiceEditor.tsx`
- Modify: `src/components/settings/SettingsPanel.tsx`

- [ ] **Step 1 : Étendre preferencesStore.ts**

Dans la section `type Persisted`, ajouter :
```typescript
voiceShortcut: string;
voiceModel: "tiny" | "base" | "small" | "medium";
voiceLang: "fr" | "en";
voiceAutoSpeak: boolean;
voiceHudDuration: number; // secondes
```

Dans `DEFAULTS`, ajouter :
```typescript
voiceShortcut: "Super+V",
voiceModel: "base",
voiceLang: "fr",
voiceAutoSpeak: true,
voiceHudDuration: 4,
```

Ajouter les setters dans `PreferencesState` :
```typescript
setVoiceModel: (m: "tiny" | "base" | "small" | "medium") => Promise<void>;
setVoiceLang: (l: "fr" | "en") => Promise<void>;
setVoiceAutoSpeak: (v: boolean) => Promise<void>;
setVoiceHudDuration: (s: number) => Promise<void>;
```

Implémenter chaque setter suivant le même pattern que `setPermissionMode` :
```typescript
setVoiceModel: async (voiceModel) => {
  set({ voiceModel });
  await persist(snapshot(get()));
},
setVoiceLang: async (voiceLang) => {
  set({ voiceLang });
  await persist(snapshot(get()));
},
setVoiceAutoSpeak: async (voiceAutoSpeak) => {
  set({ voiceAutoSpeak });
  await persist(snapshot(get()));
},
setVoiceHudDuration: async (voiceHudDuration) => {
  set({ voiceHudDuration });
  await persist(snapshot(get()));
},
```

Mettre à jour `snapshot()` pour inclure les nouveaux champs :
```typescript
function snapshot(state: PreferencesState): Persisted {
  return {
    permissionMode: state.permissionMode,
    skipDeleteWarning: state.skipDeleteWarning,
    smallFastModel: state.smallFastModel,
    longContextScope: state.longContextScope,
    voiceShortcut: state.voiceShortcut,
    voiceModel: state.voiceModel,
    voiceLang: state.voiceLang,
    voiceAutoSpeak: state.voiceAutoSpeak,
    voiceHudDuration: state.voiceHudDuration,
  };
}
```

- [ ] **Step 2 : Créer VoiceEditor.tsx**

```tsx
// src/components/settings/VoiceEditor.tsx
import { Dropdown, type DropdownOption } from "@/components/ui/Dropdown";
import { usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./ThemeEditor.module.css";

const MODEL_OPTIONS: DropdownOption<"tiny" | "base" | "small" | "medium">[] = [
  { label: "Tiny (rapide, moins précis)", value: "tiny" },
  { label: "Base (recommandé)", value: "base" },
  { label: "Small", value: "small" },
  { label: "Medium (lent, plus précis)", value: "medium" },
];

const LANG_OPTIONS: DropdownOption<"fr" | "en">[] = [
  { label: "Français", value: "fr" },
  { label: "English", value: "en" },
];

export function VoiceEditor() {
  const voiceModel = usePreferencesStore((s) => s.voiceModel);
  const setVoiceModel = usePreferencesStore((s) => s.setVoiceModel);
  const voiceLang = usePreferencesStore((s) => s.voiceLang);
  const setVoiceLang = usePreferencesStore((s) => s.setVoiceLang);
  const voiceAutoSpeak = usePreferencesStore((s) => s.voiceAutoSpeak);
  const setVoiceAutoSpeak = usePreferencesStore((s) => s.setVoiceAutoSpeak);
  const voiceHudDuration = usePreferencesStore((s) => s.voiceHudDuration);
  const setVoiceHudDuration = usePreferencesStore((s) => s.setVoiceHudDuration);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Voice</h3>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Raccourci
          <span className={styles.hint}>
            Activé/désactivé par Super+V. Configurable dans les paramètres système
            si ce raccourci est déjà pris.
          </span>
        </div>
        <div className={styles.rowControl}>
          <kbd style={{ fontSize: 11, opacity: 0.7 }}>Super + V</kbd>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Modèle Whisper
          <span className={styles.hint}>
            Modèle de transcription vocale. Base offre le meilleur compromis
            vitesse/précision.
          </span>
        </div>
        <div className={styles.rowControl}>
          <Dropdown
            size="sm"
            ariaLabel="Modèle Whisper"
            options={MODEL_OPTIONS}
            value={voiceModel}
            onChange={(v) => void setVoiceModel(v)}
          />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>Langue</div>
        <div className={styles.rowControl}>
          <Dropdown
            size="sm"
            ariaLabel="Langue"
            options={LANG_OPTIONS}
            value={voiceLang}
            onChange={(v) => void setVoiceLang(v)}
          />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Réponse vocale auto
          <span className={styles.hint}>
            Lire les réponses de Claude à voix haute via piper-tts.
          </span>
        </div>
        <div className={styles.rowControl}>
          <input
            type="checkbox"
            checked={voiceAutoSpeak}
            onChange={(e) => void setVoiceAutoSpeak(e.target.checked)}
            aria-label="Réponse vocale auto"
          />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Durée HUD
          <span className={styles.hint}>
            Secondes avant fermeture automatique du HUD après la réponse.
          </span>
        </div>
        <div className={styles.rowControl}>
          <input
            type="range"
            min={2}
            max={8}
            step={1}
            value={voiceHudDuration}
            onChange={(e) => void setVoiceHudDuration(Number(e.target.value))}
            aria-label="Durée HUD"
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 6 }}>
            {voiceHudDuration}s
          </span>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3 : Ajouter VoiceEditor dans SettingsPanel.tsx**

Dans `src/components/settings/SettingsPanel.tsx`, importer :
```tsx
import { VoiceEditor } from "./VoiceEditor";
```

Dans le `<div className={styles.body}>`, ajouter après `<ThemeEditor />` :
```tsx
<VoiceEditor />
```

- [ ] **Step 4 : Vérifier le typage**

```bash
pnpm typecheck
```

Résultat attendu : 0 erreur TypeScript.

- [ ] **Step 5 : Commit**

```bash
git add src/stores/preferencesStore.ts src/components/settings/VoiceEditor.tsx src/components/settings/SettingsPanel.tsx
git commit -m "feat(voice): voice preferences + Settings tab"
```

---

## Task 11 : Test intégration final

- [ ] **Step 1 : Lancer tous les tests Rust**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Résultat attendu : tous les tests passent (y compris les 6 nouveaux tests voice).

- [ ] **Step 2 : Vérifier le typage TypeScript**

```bash
pnpm typecheck
```

Résultat attendu : 0 erreur.

- [ ] **Step 3 : Lancer en mode dev et tester**

```bash
pnpm tauri dev
```

- Appuyer sur Super+V → la fenêtre HUD apparaît en haut au centre avec l'état "Écoute..."
- Parler → la transcription s'affiche en temps réel
- Dire "nouvelle session" → la session est créée, piper-tts annonce "Nouvelle session créée."
- Dire "Explique-moi le Rust" → le texte est envoyé à Claude, la réponse est lue
- Ouvrir Settings → onglet Voice visible avec les contrôles

- [ ] **Step 4 : Commit final**

```bash
git add -A
git commit -m "feat(voice): complete voice command feature — faster-whisper + piper-tts + HUD"
```
