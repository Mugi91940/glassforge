use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};

mod claude;
mod config;
mod fs_browse;
mod kde;
mod skills;

use claude::permissions::{Decision, PermissionBroker};
use claude::{SessionInfo, SessionRegistry};
use skills::Skill;

type RegistryState<'r> = State<'r, Arc<SessionRegistry>>;
type BrokerState<'r> = State<'r, Arc<PermissionBroker>>;

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
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(SessionRegistry::new()))
        .manage(Arc::new(PermissionBroker::new()))
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
            resolve_permission,
            kill_session,
            remove_session,
            list_sessions,
            list_project_sessions,
            load_session_history,
            get_claude_usage,
            get_rate_limits,
            list_skills,
            install_skill,
            list_dir,
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
    claude_session_id: Option<String>,
) -> Result<SessionInfo, String> {
    claude::create_session(registry.inner(), project_path, model, claude_session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_project_sessions() -> Result<Vec<claude::history::ProjectSummary>, String> {
    claude::history::list_project_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session_history(session_id: String) -> Result<Vec<serde_json::Value>, String> {
    claude::history::load_session_history(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn send_message(
    app: AppHandle,
    registry: RegistryState<'_>,
    broker: BrokerState<'_>,
    session_id: String,
    message: String,
    model: Option<String>,
    permission_mode: Option<String>,
) -> Result<(), String> {
    claude::send_message(
        registry.inner(),
        broker.inner(),
        app,
        &session_id,
        message,
        model,
        permission_mode,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn resolve_permission(
    broker: BrokerState<'_>,
    session_id: String,
    request_id: String,
    decision: Decision,
) -> Result<(), String> {
    broker
        .resolve(&session_id, &request_id, decision)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn kill_session(registry: RegistryState<'_>, session_id: String) -> Result<(), String> {
    claude::kill_session(registry.inner(), &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_session(
    registry: RegistryState<'_>,
    broker: BrokerState<'_>,
    session_id: String,
) -> Result<(), String> {
    claude::remove_session(registry.inner(), broker.inner(), &session_id).map_err(|e| e.to_string())
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
    claude::usage::fetch_rate_limits()
        .await
        .map_err(|e| e.to_string())
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
fn list_dir(path: String) -> Result<fs_browse::DirListing, String> {
    fs_browse::list_dir(&path).map_err(|e| e.to_string())
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
