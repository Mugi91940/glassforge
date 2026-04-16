//! Catalog action commands: install, uninstall, scope change, marketplace refresh.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, Context, Result};

use super::types::Scope;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn plugins_dir() -> Result<PathBuf> {
    home_dir()
        .map(|h| h.join(".claude").join("plugins"))
        .ok_or_else(|| anyhow!("HOME not set"))
}

/// Install a plugin via `claude plugin install <name>`.
pub fn install_plugin(name: &str, scope: &Scope) -> Result<()> {
    let scope_flag = match scope {
        Scope::User => "--scope=user",
        Scope::Project => "--scope=project",
        Scope::Local => "--scope=local",
    };

    let status = Command::new("claude")
        .args(["plugin", "install", name, scope_flag])
        .status()
        .context("failed to invoke claude CLI")?;

    if !status.success() {
        return Err(anyhow!("claude plugin install exited with {}", status));
    }
    Ok(())
}

/// Add a marketplace source via `claude plugin marketplace add <repo>`.
pub fn add_marketplace(repo: &str) -> Result<()> {
    let status = Command::new("claude")
        .args(["plugin", "marketplace", "add", repo])
        .status()
        .context("failed to invoke claude CLI")?;

    if !status.success() {
        return Err(anyhow!(
            "claude plugin marketplace add exited with {}",
            status
        ));
    }
    Ok(())
}

/// Uninstall a plugin or standalone skill.
///
/// For plugins (id contains `@`): shells out to `claude plugin uninstall`.
/// For standalone skills: removes the directory from `~/.claude/skills/`.
pub fn uninstall_entry(name: &str) -> Result<()> {
    if name.contains('@') {
        // Marketplace plugin — use CLI
        let status = Command::new("claude")
            .args(["plugin", "uninstall", name])
            .status()
            .context("failed to invoke claude CLI")?;

        if !status.success() {
            return Err(anyhow!("claude plugin uninstall exited with {}", status));
        }
    } else {
        // Standalone skill — remove directory
        let dir = home_dir()
            .ok_or_else(|| anyhow!("HOME not set"))?
            .join(".claude")
            .join("skills")
            .join(name);

        if !dir.is_dir() {
            return Err(anyhow!("skill directory not found: {}", dir.display()));
        }
        // Validate the name doesn't contain path traversal
        if name.contains("..") || name.contains('/') {
            return Err(anyhow!("invalid skill name: {name}"));
        }
        fs::remove_dir_all(&dir).with_context(|| format!("remove {}", dir.display()))?;
    }
    Ok(())
}

/// Change the scope of an installed plugin by modifying the appropriate
/// settings JSON files.
///
/// This reads `installed_plugins.json`, updates the scope field on the
/// matching record, and writes it back.
pub fn change_plugin_scope(plugin_id: &str, new_scope: &Scope) -> Result<()> {
    let plugins = plugins_dir()?;
    let path = plugins.join("installed_plugins.json");

    let content = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let mut doc: serde_json::Value =
        serde_json::from_str(&content).with_context(|| "parse installed_plugins.json")?;

    let scope_str = match new_scope {
        Scope::User => "user",
        Scope::Project => "project",
        Scope::Local => "local",
    };

    let plugins_map = doc
        .get_mut("plugins")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| anyhow!("installed_plugins.json missing 'plugins' object"))?;

    let records = plugins_map
        .get_mut(plugin_id)
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| anyhow!("plugin {plugin_id} not found in installed_plugins.json"))?;

    for record in records.iter_mut() {
        if let Some(obj) = record.as_object_mut() {
            obj.insert(
                "scope".to_string(),
                serde_json::Value::String(scope_str.to_string()),
            );
        }
    }

    let out = serde_json::to_string_pretty(&doc)?;
    fs::write(&path, out).with_context(|| format!("write {}", path.display()))?;

    Ok(())
}

/// Refresh all marketplace repos by running `git pull --ff-only` in each.
pub fn refresh_marketplaces() -> Result<()> {
    let plugins = plugins_dir()?;
    let known_path = plugins.join("known_marketplaces.json");

    let content = match fs::read_to_string(&known_path) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };

    let known: serde_json::Value =
        serde_json::from_str(&content).with_context(|| "parse known_marketplaces.json")?;

    let empty = serde_json::Map::new();
    let map = known.as_object().unwrap_or(&empty);

    for (name, info) in map {
        let dir = info
            .get("installLocation")
            .and_then(|v| v.as_str())
            .map(Path::new);

        let Some(dir) = dir else {
            log::warn!("marketplace {name}: missing installLocation");
            continue;
        };

        if !dir.is_dir() {
            log::warn!("marketplace {name}: dir does not exist: {}", dir.display());
            continue;
        }

        let result = Command::new("git")
            .args(["-C", &dir.to_string_lossy(), "pull", "--ff-only"])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                log::info!("marketplace {name}: refreshed");
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::warn!("marketplace {name}: git pull failed: {stderr}");
            }
            Err(e) => {
                log::warn!("marketplace {name}: failed to run git: {e}");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tempdir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "glassforge-actions-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn change_scope_updates_json() {
        let dir = tempdir();
        let json = r#"{
            "version": 2,
            "plugins": {
                "test-plugin@marketplace": [
                    {"scope": "user", "installPath": "/tmp/test", "version": "1.0.0"}
                ]
            }
        }"#;
        let path = dir.join("installed_plugins.json");
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(json.as_bytes()).unwrap();

        // Temporarily override HOME so plugins_dir() points to our tempdir.
        // This is safe in tests since we're not doing concurrent HOME access.
        let orig_home = std::env::var_os("HOME");
        let fake_home = tempdir();
        let fake_plugins = fake_home.join(".claude").join("plugins");
        fs::create_dir_all(&fake_plugins).unwrap();
        fs::copy(&path, fake_plugins.join("installed_plugins.json")).unwrap();
        std::env::set_var("HOME", &fake_home);

        let result = change_plugin_scope("test-plugin@marketplace", &Scope::Project);
        assert!(result.is_ok(), "change_plugin_scope failed: {result:?}");

        let updated = fs::read_to_string(fake_plugins.join("installed_plugins.json")).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&updated).unwrap();
        let scope = doc["plugins"]["test-plugin@marketplace"][0]["scope"]
            .as_str()
            .unwrap();
        assert_eq!(scope, "project");

        // Restore HOME
        if let Some(h) = orig_home {
            std::env::set_var("HOME", h);
        }
    }

    #[test]
    fn change_scope_fails_for_unknown_plugin() {
        let fake_home = tempdir();
        let fake_plugins = fake_home.join(".claude").join("plugins");
        fs::create_dir_all(&fake_plugins).unwrap();
        let json = r#"{"version": 2, "plugins": {}}"#;
        let mut f = fs::File::create(fake_plugins.join("installed_plugins.json")).unwrap();
        f.write_all(json.as_bytes()).unwrap();

        let orig_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &fake_home);

        let result = change_plugin_scope("nonexistent@mp", &Scope::User);
        assert!(result.is_err());

        if let Some(h) = orig_home {
            std::env::set_var("HOME", h);
        }
    }
}
