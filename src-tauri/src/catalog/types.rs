//! Shared types for the unified catalog (skills + plugins + marketplaces).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// A single entry in the unified catalog — can represent a standalone skill,
/// a marketplace plugin, or an installed plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogEntry {
    /// Unique id: `"name@marketplace"` for marketplace plugins, or bare name
    /// for standalone skills.
    pub id: String,
    pub name: String,
    pub description: String,
    pub entry_type: EntryType,
    pub source: Source,
    pub version: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub category: Option<String>,
    pub keywords: Vec<String>,
    pub install_count: Option<u64>,
    pub installed: Option<InstalledInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EntryType {
    Skill,
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Source {
    Marketplace { name: String },
    Standalone,
    Git { url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Scope {
    User,
    Project,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledInfo {
    pub scope: Scope,
    pub version: String,
    pub path: PathBuf,
    pub has_update: bool,
}

// ── Raw deserialization helpers for on-disk JSON formats ─────────────

/// A single plugin entry inside `marketplace.json`.
#[derive(Debug, Deserialize)]
pub struct RawMarketplacePlugin {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub author: Option<RawAuthor>,
    #[serde(default)]
    pub source: Option<RawPluginSource>,
}

/// The `author` field in marketplace entries can be either:
/// - an object `{ name, email }` (Anthropic plugins)
/// - a bare string (community plugins)
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum RawAuthor {
    Object { name: String },
    Plain(String),
}

impl RawAuthor {
    pub fn to_name(&self) -> String {
        match self {
            RawAuthor::Object { name } => name.clone(),
            RawAuthor::Plain(s) => s.clone(),
        }
    }
}

/// The polymorphic `source` field inside marketplace plugin entries.
/// Used to extract a repo URL when available — we don't need the full shape.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
#[allow(dead_code)] // variants/fields needed for serde discrimination
pub enum RawPluginSource {
    UrlObject {
        url: String,
        #[serde(default)]
        sha: Option<String>,
    },
    GitSubdir {
        url: String,
        path: String,
        #[serde(default)]
        sha: Option<String>,
    },
    /// Bare string path (e.g. `"./plugins/foo"`).
    Local(String),
}

impl RawPluginSource {
    /// Best-effort repository URL from the source.
    pub fn repo_url(&self) -> Option<String> {
        match self {
            RawPluginSource::UrlObject { url, .. } | RawPluginSource::GitSubdir { url, .. } => {
                let u = url.trim_end_matches(".git");
                if u.contains("github.com") || u.contains('/') {
                    if u.starts_with("http") {
                        Some(u.to_string())
                    } else {
                        Some(format!("https://github.com/{u}"))
                    }
                } else {
                    None
                }
            }
            RawPluginSource::Local(_) => None,
        }
    }

    #[allow(dead_code)] // used in step 2 for has_update detection
    pub fn sha(&self) -> Option<&str> {
        match self {
            RawPluginSource::UrlObject { sha, .. } | RawPluginSource::GitSubdir { sha, .. } => {
                sha.as_deref()
            }
            RawPluginSource::Local(_) => None,
        }
    }
}

/// Top-level shape of `marketplace.json`.
#[derive(Debug, Deserialize)]
pub struct RawMarketplaceFile {
    pub plugins: Vec<RawMarketplacePlugin>,
}

/// A single count entry from `install-counts-cache.json`.
#[derive(Debug, Deserialize)]
pub struct RawInstallCount {
    pub plugin: String,
    pub unique_installs: u64,
}

/// Top-level shape of `install-counts-cache.json`.
#[derive(Debug, Deserialize)]
pub struct RawInstallCountsFile {
    #[serde(default)]
    pub counts: Vec<RawInstallCount>,
}

/// A single installed plugin record inside `installed_plugins.json`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawInstalledRecord {
    pub scope: String,
    pub install_path: String,
    pub version: String,
    #[serde(default)]
    #[allow(dead_code)] // reserved for future has_update via SHA comparison
    pub git_commit_sha: Option<String>,
}

/// Top-level shape of `installed_plugins.json`.
#[derive(Debug, Deserialize)]
pub struct RawInstalledFile {
    #[serde(default)]
    pub plugins: std::collections::HashMap<String, Vec<RawInstalledRecord>>,
}

/// A marketplace source entry from `known_marketplaces.json`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawKnownMarketplace {
    pub install_location: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_author_object() {
        let json = r#"{"name": "Anthropic", "email": "support@anthropic.com"}"#;
        let a: RawAuthor = serde_json::from_str(json).unwrap();
        assert_eq!(a.to_name(), "Anthropic");
    }

    #[test]
    fn deserialize_author_string() {
        let json = r#""Jesse Kriss""#;
        let a: RawAuthor = serde_json::from_str(json).unwrap();
        assert_eq!(a.to_name(), "Jesse Kriss");
    }

    #[test]
    fn deserialize_source_url_object() {
        let json = r#"{"source": "url", "url": "https://github.com/foo/bar.git", "sha": "abc123"}"#;
        let s: RawPluginSource = serde_json::from_str(json).unwrap();
        assert_eq!(s.repo_url(), Some("https://github.com/foo/bar".to_string()));
        assert_eq!(s.sha(), Some("abc123"));
    }

    #[test]
    fn deserialize_source_git_subdir() {
        let json = r#"{"source": "git-subdir", "url": "techwolf-ai/ai-first-toolkit", "path": "plugins/ai-firstify", "ref": "main", "sha": "abc"}"#;
        let s: RawPluginSource = serde_json::from_str(json).unwrap();
        assert_eq!(
            s.repo_url(),
            Some("https://github.com/techwolf-ai/ai-first-toolkit".to_string())
        );
    }

    #[test]
    fn deserialize_source_local_string() {
        let json = r#""./plugins/agent-sdk-dev""#;
        let s: RawPluginSource = serde_json::from_str(json).unwrap();
        assert!(s.repo_url().is_none());
    }

    #[test]
    fn deserialize_marketplace_plugin_minimal() {
        let json = r#"{"name": "test-plugin", "description": "A test"}"#;
        let p: RawMarketplacePlugin = serde_json::from_str(json).unwrap();
        assert_eq!(p.name, "test-plugin");
        assert_eq!(p.description.as_deref(), Some("A test"));
        assert!(p.author.is_none());
        assert!(p.source.is_none());
    }

    #[test]
    fn deserialize_installed_record() {
        let json = r#"{
            "scope": "user",
            "installPath": "/home/user/.claude/plugins/cache/foo/bar/1.0.0",
            "version": "1.0.0",
            "installedAt": "2026-01-01T00:00:00.000Z",
            "lastUpdated": "2026-01-01T00:00:00.000Z",
            "gitCommitSha": "abc123"
        }"#;
        let r: RawInstalledRecord = serde_json::from_str(json).unwrap();
        assert_eq!(r.scope, "user");
        assert_eq!(r.version, "1.0.0");
        assert_eq!(r.git_commit_sha.as_deref(), Some("abc123"));
    }

    #[test]
    fn scope_round_trip() {
        let s = Scope::User;
        let json = serde_json::to_string(&s).unwrap();
        let back: Scope = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }
}
