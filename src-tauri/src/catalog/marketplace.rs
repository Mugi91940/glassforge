//! Reads marketplace catalogs from `~/.claude/plugins/marketplaces/*/` and
//! merges install counts from `install-counts-cache.json`.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use std::path::Path;

use anyhow::Result;

use super::types::{
    CatalogEntry, EntryType, RawInstallCountsFile, RawKnownMarketplace, RawMarketplaceFile, Source,
};

fn plugins_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude").join("plugins"))
}

/// Load install counts keyed by `"name@marketplace"`.
fn load_install_counts(plugins: &Path) -> HashMap<String, u64> {
    let path = plugins.join("install-counts-cache.json");
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };
    let file: RawInstallCountsFile = match serde_json::from_str(&content) {
        Ok(f) => f,
        Err(e) => {
            log::warn!("malformed install-counts-cache.json: {e}");
            return HashMap::new();
        }
    };
    file.counts
        .into_iter()
        .map(|c| (c.plugin, c.unique_installs))
        .collect()
}

/// Discover marketplace directories from `known_marketplaces.json`.
fn discover_marketplace_dirs(plugins: &Path) -> Vec<(String, PathBuf)> {
    let path = plugins.join("known_marketplaces.json");
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let map: HashMap<String, RawKnownMarketplace> = match serde_json::from_str(&content) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("malformed known_marketplaces.json: {e}");
            return Vec::new();
        }
    };
    map.into_iter()
        .map(|(name, info)| (name, PathBuf::from(info.install_location)))
        .collect()
}

/// Scan all known marketplaces and return catalog entries.
pub fn list_marketplace_entries() -> Result<Vec<CatalogEntry>> {
    let plugins =
        plugins_dir().ok_or_else(|| anyhow::anyhow!("HOME not set, cannot locate plugins dir"))?;

    let counts = load_install_counts(&plugins);
    let dirs = discover_marketplace_dirs(&plugins);

    let mut out = Vec::new();

    for (marketplace_name, dir) in dirs {
        let mp_file = dir.join(".claude-plugin").join("marketplace.json");
        let content = match fs::read_to_string(&mp_file) {
            Ok(c) => c,
            Err(e) => {
                log::warn!(
                    "skipping marketplace {marketplace_name}: cannot read {}: {e}",
                    mp_file.display()
                );
                continue;
            }
        };
        let mp: RawMarketplaceFile = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                log::warn!("skipping marketplace {marketplace_name}: malformed JSON: {e}");
                continue;
            }
        };

        for plugin in mp.plugins {
            let id = format!("{}@{}", plugin.name, marketplace_name);
            let install_count = counts.get(&id).copied();
            let repository = plugin.source.as_ref().and_then(|s| s.repo_url());
            let author = plugin.author.as_ref().map(|a| a.to_name());

            out.push(CatalogEntry {
                id,
                name: plugin.name,
                description: plugin.description.unwrap_or_default(),
                entry_type: EntryType::Plugin,
                source: Source::Marketplace {
                    name: marketplace_name.clone(),
                },
                version: None,
                author,
                license: None,
                homepage: plugin.homepage,
                repository,
                category: plugin.category,
                keywords: Vec::new(),
                install_count,
                installed: None,
            });
        }
    }

    out.sort_by_key(|s| s.name.to_lowercase());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tempdir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "glassforge-marketplace-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn load_install_counts_parses_correctly() {
        let dir = tempdir();
        let json = r#"{
            "version": 1,
            "fetchedAt": "2026-01-01T00:00:00Z",
            "counts": [
                {"plugin": "foo@bar", "unique_installs": 42},
                {"plugin": "baz@bar", "unique_installs": 99}
            ]
        }"#;
        let mut f = fs::File::create(dir.join("install-counts-cache.json")).unwrap();
        f.write_all(json.as_bytes()).unwrap();

        let counts = load_install_counts(&dir);
        assert_eq!(counts.get("foo@bar"), Some(&42));
        assert_eq!(counts.get("baz@bar"), Some(&99));
        assert_eq!(counts.len(), 2);
    }

    #[test]
    fn load_install_counts_handles_missing_file() {
        let dir = tempdir();
        let counts = load_install_counts(&dir);
        assert!(counts.is_empty());
    }

    #[test]
    fn parse_marketplace_file_with_mixed_sources() {
        let json = r#"{
            "plugins": [
                {
                    "name": "simple",
                    "description": "A simple plugin",
                    "category": "development"
                },
                {
                    "name": "with-url",
                    "description": "Has URL source",
                    "source": {"source": "url", "url": "https://github.com/foo/bar.git"},
                    "homepage": "https://example.com"
                },
                {
                    "name": "with-author",
                    "description": "Has author",
                    "author": {"name": "Anthropic", "email": "support@anthropic.com"}
                },
                {
                    "name": "local-source",
                    "description": "Local path source",
                    "source": "./plugins/local"
                },
                {
                    "name": "github-source",
                    "description": "Github repo source",
                    "source": {"source": "github", "repo": "user/repo"}
                }
            ]
        }"#;
        let mp: RawMarketplaceFile = serde_json::from_str(json).unwrap();
        assert_eq!(mp.plugins.len(), 5);

        assert!(mp.plugins[0].source.is_none());
        assert_eq!(
            mp.plugins[1].source.as_ref().unwrap().repo_url(),
            Some("https://github.com/foo/bar".to_string())
        );
        assert_eq!(
            mp.plugins[2].author.as_ref().unwrap().to_name(),
            "Anthropic"
        );
        assert!(mp.plugins[3].source.as_ref().unwrap().repo_url().is_none());
        assert_eq!(
            mp.plugins[4].source.as_ref().unwrap().repo_url(),
            Some("https://github.com/user/repo".to_string())
        );
    }

    #[test]
    fn discover_marketplace_dirs_parses_known_marketplaces() {
        let dir = tempdir();
        let json = r#"{
            "test-mp": {
                "source": {"source": "github", "repo": "test/test"},
                "installLocation": "/tmp/test-mp",
                "lastUpdated": "2026-01-01T00:00:00Z"
            }
        }"#;
        let mut f = fs::File::create(dir.join("known_marketplaces.json")).unwrap();
        f.write_all(json.as_bytes()).unwrap();

        let dirs = discover_marketplace_dirs(&dir);
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0].0, "test-mp");
        assert_eq!(dirs[0].1, PathBuf::from("/tmp/test-mp"));
    }

    #[test]
    fn discover_marketplace_dirs_handles_missing_file() {
        let dir = tempdir();
        let dirs = discover_marketplace_dirs(&dir);
        assert!(dirs.is_empty());
    }
}
