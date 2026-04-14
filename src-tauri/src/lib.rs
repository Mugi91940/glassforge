use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewWindow};

mod claude;
mod config;
mod kde;
mod skills;

use claude::{SessionInfo, SessionRegistry};
use skills::Skill;

type RegistryState<'r> = State<'r, Arc<SessionRegistry>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Arc::new(SessionRegistry::new()))
        .setup(|app| {
            tracing::info!("glassforge starting up");
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            create_session,
            send_message,
            kill_session,
            list_sessions,
            list_skills,
            install_skill,
            set_kde_blur,
            detect_display_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn health_check() -> &'static str {
    "ok"
}

#[tauri::command]
fn create_session(
    app: AppHandle,
    registry: RegistryState<'_>,
    project_path: String,
    model: Option<String>,
) -> Result<SessionInfo, String> {
    claude::create_session(registry.inner(), app, project_path, model).map_err(|e| e.to_string())
}

#[tauri::command]
fn send_message(
    registry: RegistryState<'_>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    claude::send_message(registry.inner(), &session_id, &message).map_err(|e| e.to_string())
}

#[tauri::command]
fn kill_session(registry: RegistryState<'_>, session_id: String) -> Result<(), String> {
    claude::kill_session(registry.inner(), &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_sessions(registry: RegistryState<'_>) -> Vec<SessionInfo> {
    claude::list_sessions(registry.inner())
}

#[tauri::command]
fn list_skills() -> Result<Vec<Skill>, String> {
    skills::list_skills().map_err(|e| e.to_string())
}

#[tauri::command]
fn install_skill(url: String) -> Result<Skill, String> {
    skills::install_skill_from_git(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_kde_blur(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        kde::blur::apply_blur(&window, enabled).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, enabled);
        Err("KDE blur is only available on Linux".to_string())
    }
}

#[tauri::command]
fn detect_display_server() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        match kde::blur::detect_session_type() {
            kde::blur::SessionType::Wayland => "wayland",
            kde::blur::SessionType::X11 => "x11",
            kde::blur::SessionType::Unknown => "unknown",
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        "unsupported"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_check_returns_ok() {
        assert_eq!(health_check(), "ok");
    }

    #[test]
    fn list_sessions_on_empty_registry_is_empty() {
        let registry = Arc::new(SessionRegistry::new());
        assert!(claude::list_sessions(&registry).is_empty());
    }
}
