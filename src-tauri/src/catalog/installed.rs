//! Reads installed plugins from `~/.claude/plugins/installed_plugins.json`
//! and standalone skills from `~/.claude/skills/`.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;

use super::types::{CatalogEntry, EntryType, InstalledInfo, RawInstalledFile, Scope, Source};

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn parse_scope(s: &str) -> Scope {
    match s {
        "project" => Scope::Project,
        "local" => Scope::Local,
        _ => Scope::User,
    }
}

/// List all installed plugins as catalog entries.
///
/// Reads `~/.claude/plugins/installed_plugins.json` and enriches each
/// record with metadata from `marketplace.json` in the marketplace dirs
/// (category, homepage, author) when available.
pub fn list_installed() -> Result<Vec<CatalogEntry>> {
    let home = match home_dir() {
        Some(h) => h,
        None => return Ok(Vec::new()),
    };
    let plugins_dir = home.join(".claude").join("plugins");
    let path = plugins_dir.join("installed_plugins.json");

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    let file: RawInstalledFile = match serde_json::from_str(&content) {
        Ok(f) => f,
        Err(e) => {
            log::warn!("malformed installed_plugins.json: {e}");
            return Ok(Vec::new());
        }
    };

    let mut out = Vec::new();

    for (id, records) in &file.plugins {
        // Take the first (most recent) record for this plugin.
        let record = match records.first() {
            Some(r) => r,
            None => continue,
        };

        // id format is "name@marketplace"
        let name = id.split('@').next().unwrap_or(id).to_string();

        // Try to read package.json from install path for version/description.
        let pkg = read_package_json(Path::new(&record.install_path));

        out.push(CatalogEntry {
            id: id.clone(),
            name,
            description: pkg.description.unwrap_or_default(),
            entry_type: EntryType::Plugin,
            source: Source::Marketplace {
                name: id.split('@').nth(1).unwrap_or("unknown").to_string(),
            },
            version: Some(record.version.clone()),
            author: pkg.author,
            license: pkg.license,
            homepage: pkg.homepage,
            repository: None,
            category: None,
            keywords: Vec::new(),
            install_count: None,
            installed: Some(InstalledInfo {
                scope: parse_scope(&record.scope),
                version: record.version.clone(),
                path: PathBuf::from(&record.install_path),
                has_update: false, // v1: no marketplace version to compare against
            }),
        });
    }

    // Also include standalone skills from ~/.claude/skills/
    let skills_dir = home.join(".claude").join("skills");
    if skills_dir.is_dir() {
        append_standalone_skills(&skills_dir, &mut out)?;
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Minimal fields we extract from a plugin's `package.json`.
struct PkgMeta {
    description: Option<String>,
    author: Option<String>,
    license: Option<String>,
    homepage: Option<String>,
}

fn read_package_json(install_path: &Path) -> PkgMeta {
    let pkg_path = install_path.join("package.json");
    let content = match fs::read_to_string(&pkg_path) {
        Ok(c) => c,
        Err(_) => {
            return PkgMeta {
                description: None,
                author: None,
                license: None,
                homepage: None,
            }
        }
    };
    let val: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => {
            return PkgMeta {
                description: None,
                author: None,
                license: None,
                homepage: None,
            }
        }
    };
    PkgMeta {
        description: val
            .get("description")
            .and_then(|v| v.as_str())
            .map(String::from),
        author: val.get("author").and_then(|v| {
            v.as_str()
                .map(String::from)
                .or_else(|| v.get("name").and_then(|n| n.as_str()).map(String::from))
        }),
        license: val
            .get("license")
            .and_then(|v| v.as_str())
            .map(String::from),
        homepage: val
            .get("homepage")
            .and_then(|v| v.as_str())
            .map(String::from),
    }
}

/// Scan `~/.claude/skills/` for standalone skills (folders with `SKILL.md`).
fn append_standalone_skills(dir: &Path, out: &mut Vec<CatalogEntry>) -> Result<()> {
    for entry in fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let content = fs::read_to_string(&skill_md).unwrap_or_default();
        let (name, description) = crate::skills::parse_frontmatter(&content, &path);

        let folder_name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "skill".to_string());

        out.push(CatalogEntry {
            id: folder_name,
            name,
            description,
            entry_type: EntryType::Skill,
            source: Source::Standalone,
            version: None,
            author: None,
            license: None,
            homepage: None,
            repository: None,
            category: None,
            keywords: Vec::new(),
            install_count: None,
            installed: Some(InstalledInfo {
                scope: Scope::User,
                version: String::new(),
                path,
                has_update: false,
            }),
        });
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
            "glassforge-installed-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn parse_scope_maps_known_values() {
        assert_eq!(parse_scope("user"), Scope::User);
        assert_eq!(parse_scope("project"), Scope::Project);
        assert_eq!(parse_scope("local"), Scope::Local);
        assert_eq!(parse_scope("unknown"), Scope::User);
    }

    #[test]
    fn read_package_json_extracts_fields() {
        let dir = tempdir();
        let json = r#"{"name": "test", "version": "1.0.0", "description": "A test plugin", "license": "MIT"}"#;
        let mut f = fs::File::create(dir.join("package.json")).unwrap();
        f.write_all(json.as_bytes()).unwrap();

        let pkg = read_package_json(&dir);
        assert_eq!(pkg.description.as_deref(), Some("A test plugin"));
        assert_eq!(pkg.license.as_deref(), Some("MIT"));
    }

    #[test]
    fn read_package_json_handles_missing() {
        let dir = tempdir();
        let pkg = read_package_json(&dir);
        assert!(pkg.description.is_none());
    }

    #[test]
    fn append_standalone_skills_finds_skill_md() {
        let dir = tempdir();
        let skill_dir = dir.join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        let mut f = fs::File::create(skill_dir.join("SKILL.md")).unwrap();
        writeln!(f, "---\nname: my-skill\ndescription: a test skill\n---\n").unwrap();

        let mut entries = Vec::new();
        append_standalone_skills(&dir, &mut entries).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "my-skill");
        assert_eq!(entries[0].description, "a test skill");
        assert_eq!(entries[0].entry_type, EntryType::Skill);
        assert!(entries[0].installed.is_some());
    }

    #[test]
    fn append_standalone_skills_skips_dirs_without_skill_md() {
        let dir = tempdir();
        let no_skill = dir.join("empty-dir");
        fs::create_dir_all(&no_skill).unwrap();

        let mut entries = Vec::new();
        append_standalone_skills(&dir, &mut entries).unwrap();
        assert!(entries.is_empty());
    }
}
