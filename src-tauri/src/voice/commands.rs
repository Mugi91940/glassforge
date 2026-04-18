// src-tauri/src/voice/commands.rs
use std::sync::Arc;
use tauri::State;

use crate::voice::{SidecarCmd, VoiceState};

type VoiceStateRef<'r> = State<'r, Arc<VoiceState>>;

#[tauri::command]
pub fn voice_start_listen(state: VoiceStateRef<'_>, lang: Option<String>) -> Result<(), String> {
    let guard = state.sidecar.lock().unwrap();
    if let Some(sc) = guard.as_ref() {
        sc.send(&SidecarCmd::StartListen {
            lang: lang.unwrap_or_else(|| "fr".into()),
        })
        .map_err(|e| e.to_string())?;
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
        sc.send(&SidecarCmd::StopListen)
            .map_err(|e| e.to_string())?;
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
pub fn voice_set_model(state: VoiceStateRef<'_>, model: String) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_new_session() {
        assert_eq!(
            voice_detect_command("Nouvelle session".into()),
            Some("new_session".into())
        );
    }

    #[test]
    fn detects_close_session() {
        assert_eq!(
            voice_detect_command("Ferme la session".into()),
            Some("close_session".into())
        );
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
