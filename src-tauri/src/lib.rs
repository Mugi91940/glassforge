use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};

mod attachments;
mod catalog;
mod claude;
mod config;
mod fs_browse;
mod kde;
mod skills;
mod voice;

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
            delete_session_file,
            read_git_info,
            get_claude_usage,
            get_rate_limits,
            list_skills,
            install_skill,
            list_marketplace_entries,
            list_installed_plugins,
            install_catalog_plugin,
            uninstall_catalog_plugin,
            change_catalog_plugin_scope,
            refresh_catalog_marketplaces,
            add_catalog_marketplace,
            list_dir,
            save_clipboard_image,
            read_image_as_data_url,
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
fn delete_session_file(session_id: String) -> Result<(), String> {
    claude::history::delete_session_file(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_git_info(project_path: String) -> Option<GitInfo> {
    git_info(&project_path)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GitInfo {
    repo_name: String,
    branch: Option<String>,
}

fn git_info(project_path: &str) -> Option<GitInfo> {
    let p = std::path::PathBuf::from(project_path);
    if !p.is_dir() {
        return None;
    }
    let head = p.join(".git").join("HEAD");
    if !head.is_file() {
        return None;
    }
    let repo_name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let branch = std::fs::read_to_string(&head).ok().and_then(|content| {
        let trimmed = content.trim();
        if let Some(r) = trimmed.strip_prefix("ref: refs/heads/") {
            Some(r.to_string())
        } else if trimmed.len() >= 8 {
            Some(format!("detached {}", &trimmed[..8]))
        } else {
            None
        }
    });
    Some(GitInfo { repo_name, branch })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // tauri command signature, each arg maps to a JS call kwarg
fn send_message(
    app: AppHandle,
    registry: RegistryState<'_>,
    broker: BrokerState<'_>,
    session_id: String,
    message: String,
    model: Option<String>,
    permission_mode: Option<String>,
    small_fast_model: Option<String>,
) -> Result<(), String> {
    claude::send_message(
        registry.inner(),
        broker.inner(),
        app,
        &session_id,
        message,
        model,
        permission_mode,
        small_fast_model,
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
async fn list_marketplace_entries() -> Result<Vec<catalog::CatalogEntry>, String> {
    tokio::task::spawn_blocking(|| catalog::list_marketplace_entries().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_installed_plugins() -> Result<Vec<catalog::CatalogEntry>, String> {
    tokio::task::spawn_blocking(|| catalog::list_installed().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_catalog_plugin(name: String, scope: catalog::Scope) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        catalog::install_plugin(&name, &scope).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn uninstall_catalog_plugin(name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || catalog::uninstall_entry(&name).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn change_catalog_plugin_scope(
    plugin_id: String,
    new_scope: catalog::Scope,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        catalog::change_plugin_scope(&plugin_id, &new_scope).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn refresh_catalog_marketplaces() -> Result<(), String> {
    tokio::task::spawn_blocking(|| catalog::refresh_marketplaces().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn add_catalog_marketplace(repo: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || catalog::add_marketplace(&repo).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_dir(path: String) -> Result<fs_browse::DirListing, String> {
    fs_browse::list_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_clipboard_image(bytes: Vec<u8>, extension: String) -> Result<String, String> {
    attachments::save_bytes_to_temp(bytes, &extension)
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_image_as_data_url(path: String) -> Result<String, String> {
    attachments::read_as_data_url(std::path::Path::new(&path)).map_err(|e| e.to_string())
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
