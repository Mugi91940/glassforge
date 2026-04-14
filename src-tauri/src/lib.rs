use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};

mod claude;
mod config;
mod kde;
mod skills;

use claude::{SessionInfo, SessionRegistry};
use skills::Skill;

type RegistryState<'r> = State<'r, Arc<SessionRegistry>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Arc::new(SessionRegistry::new()))
        .setup(|app| {
            log::info!("glassforge starting up");
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            #[cfg(not(debug_assertions))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            create_session,
            send_message,
            kill_session,
            remove_session,
            list_sessions,
            get_claude_usage,
            get_rate_limits,
            get_usage_hook_status,
            install_usage_hook,
            uninstall_usage_hook,
            list_skills,
            install_skill,
            set_kde_blur,
            set_kde_blur_strength,
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
    registry: RegistryState<'_>,
    project_path: String,
    model: Option<String>,
) -> Result<SessionInfo, String> {
    claude::create_session(registry.inner(), project_path, model).map_err(|e| e.to_string())
}

#[tauri::command]
fn send_message(
    app: AppHandle,
    registry: RegistryState<'_>,
    session_id: String,
    message: String,
    model: Option<String>,
) -> Result<(), String> {
    claude::send_message(registry.inner(), app, &session_id, message, model)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn kill_session(registry: RegistryState<'_>, session_id: String) -> Result<(), String> {
    claude::kill_session(registry.inner(), &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_session(registry: RegistryState<'_>, session_id: String) -> Result<(), String> {
    claude::remove_session(registry.inner(), &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_sessions(registry: RegistryState<'_>) -> Vec<SessionInfo> {
    claude::list_sessions(registry.inner())
}

#[tauri::command]
async fn get_claude_usage() -> Result<claude::usage::Snapshot, String> {
    tokio::task::spawn_blocking(|| claude::usage::compute().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_rate_limits() -> Result<Option<claude::usage::RateLimits>, String> {
    tokio::task::spawn_blocking(|| claude::usage::read_rate_limits().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_usage_hook_status() -> Result<claude::usage::HookStatus, String> {
    claude::usage::status().map_err(|e| e.to_string())
}

#[tauri::command]
fn install_usage_hook() -> Result<claude::usage::HookStatus, String> {
    claude::usage::install_usage_hook().map_err(|e| e.to_string())
}

#[tauri::command]
fn uninstall_usage_hook() -> Result<claude::usage::HookStatus, String> {
    claude::usage::uninstall_usage_hook().map_err(|e| e.to_string())
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
fn set_kde_blur_strength(strength: u8) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        kde::blur::set_blur_strength(strength).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = strength;
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
