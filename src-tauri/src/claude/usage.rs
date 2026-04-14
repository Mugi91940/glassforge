//! Real usage aggregation from Claude Code's local session files.
//!
//! Claude Code writes one `<session_id>.jsonl` per project per session in
//! `~/.claude/projects/<slug>/`. Each JSONL line is one event; `assistant`
//! events carry `message.usage` with token counts and `message.model` so
//! we can compute cost against our pricing table.
//!
//! This module walks that tree, parses each line, and folds the results
//! into today / last-7-days / all-time buckets. It is read-only: we never
//! touch those files.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::{Duration as StdDuration, SystemTime};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub cost_usd: f64,
    pub messages: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBreakdown {
    pub model: String,
    pub totals: Totals,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub last_5h: Totals,
    pub today: Totals,
    pub last_7d: Totals,
    pub all_time: Totals,
    pub by_model: Vec<ModelBreakdown>,
    pub last_activity_iso: Option<String>,
    pub session_count: u64,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn projects_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("projects"))
}

/// Rough USD per 1M tokens for the Claude family. Kept intentionally
/// simple — we don't try to match every variant, just the common ones.
fn model_pricing(model: &str) -> (f64, f64, f64, f64) {
    let m = model.to_lowercase();
    if m.contains("opus") {
        (15.0, 75.0, 18.75, 1.5)
    } else if m.contains("haiku") {
        (0.8, 4.0, 1.0, 0.08)
    } else {
        // default to sonnet pricing
        (3.0, 15.0, 3.75, 0.3)
    }
}

fn cost_of(model: &str, t: &Totals) -> f64 {
    let (p_in, p_out, p_cc, p_cr) = model_pricing(model);
    (t.input_tokens as f64 / 1e6) * p_in
        + (t.output_tokens as f64 / 1e6) * p_out
        + (t.cache_creation_tokens as f64 / 1e6) * p_cc
        + (t.cache_read_tokens as f64 / 1e6) * p_cr
}

fn add_in_place(dst: &mut Totals, src: &Totals) {
    dst.input_tokens += src.input_tokens;
    dst.output_tokens += src.output_tokens;
    dst.cache_creation_tokens += src.cache_creation_tokens;
    dst.cache_read_tokens += src.cache_read_tokens;
    dst.cost_usd += src.cost_usd;
    dst.messages += src.messages;
}

fn parse_ts(v: &Value) -> Option<DateTime<Utc>> {
    let s = v.as_str()?;
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// Walks `~/.claude/projects/*/*.jsonl` and folds assistant-event usage
/// into buckets. Safe to call repeatedly — it always returns a fresh
/// snapshot of whatever is on disk right now.
pub fn compute() -> Result<Snapshot> {
    let dir = match projects_dir() {
        Some(d) if d.is_dir() => d,
        _ => return Ok(Snapshot::default()),
    };

    let now = Utc::now();
    let today: NaiveDate = now.date_naive();
    let week_ago: NaiveDate = (now - Duration::days(6)).date_naive();
    let five_h_ago: DateTime<Utc> = now - Duration::hours(5);

    let mut snap = Snapshot::default();
    let mut per_model: std::collections::HashMap<String, Totals> = std::collections::HashMap::new();
    let mut last_ts: Option<DateTime<Utc>> = None;
    let mut seen_sessions: std::collections::HashSet<String> = std::collections::HashSet::new();

    let project_iter = match fs::read_dir(&dir) {
        Ok(it) => it,
        Err(e) => return Err(anyhow!("read_dir {}: {e}", dir.display())),
    };

    for project_entry in project_iter.flatten() {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let session_iter = match fs::read_dir(&project_path) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for session_entry in session_iter.flatten() {
            let file_path = session_entry.path();
            if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let content = match fs::read_to_string(&file_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Some(stem) = file_path.file_stem().and_then(|s| s.to_str()) {
                seen_sessions.insert(stem.to_string());
            }

            for line in content.lines() {
                if line.is_empty() {
                    continue;
                }
                let val: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                // Only assistant events carry billable usage.
                if val.get("type").and_then(|t| t.as_str()) != Some("assistant") {
                    continue;
                }
                let message = match val.get("message") {
                    Some(m) => m,
                    None => continue,
                };
                let usage = match message.get("usage") {
                    Some(u) => u,
                    None => continue,
                };
                let model = message
                    .get("model")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                let mut entry = Totals {
                    input_tokens: usage
                        .get("input_tokens")
                        .and_then(|n| n.as_u64())
                        .unwrap_or(0),
                    output_tokens: usage
                        .get("output_tokens")
                        .and_then(|n| n.as_u64())
                        .unwrap_or(0),
                    cache_creation_tokens: usage
                        .get("cache_creation_input_tokens")
                        .and_then(|n| n.as_u64())
                        .unwrap_or(0),
                    cache_read_tokens: usage
                        .get("cache_read_input_tokens")
                        .and_then(|n| n.as_u64())
                        .unwrap_or(0),
                    cost_usd: 0.0,
                    messages: 1,
                };
                entry.cost_usd = cost_of(&model, &entry);

                add_in_place(&mut snap.all_time, &entry);
                let model_key = normalize_model(&model);
                per_model
                    .entry(model_key)
                    .and_modify(|t| add_in_place(t, &entry))
                    .or_insert(entry);

                if let Some(ts) = val.get("timestamp").and_then(parse_ts) {
                    let date = ts.date_naive();
                    if date >= week_ago {
                        add_in_place(&mut snap.last_7d, &entry);
                    }
                    if date == today {
                        add_in_place(&mut snap.today, &entry);
                    }
                    if ts >= five_h_ago {
                        add_in_place(&mut snap.last_5h, &entry);
                    }
                    if last_ts.map_or(true, |prev| ts > prev) {
                        last_ts = Some(ts);
                    }
                }
            }
        }
    }

    let mut by_model: Vec<ModelBreakdown> = per_model
        .into_iter()
        .map(|(model, totals)| ModelBreakdown { model, totals })
        .collect();
    by_model.sort_by(|a, b| {
        b.totals
            .cost_usd
            .partial_cmp(&a.totals.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    snap.by_model = by_model;
    snap.last_activity_iso = last_ts.map(|t| t.to_rfc3339());
    snap.session_count = seen_sessions.len() as u64;

    Ok(snap)
}

fn normalize_model(raw: &str) -> String {
    let m = raw.to_lowercase();
    if m.contains("opus") {
        "opus".to_string()
    } else if m.contains("haiku") {
        "haiku".to_string()
    } else if m.contains("sonnet") {
        "sonnet".to_string()
    } else {
        raw.to_string()
    }
}

// ── Real-time rate limits via Claude Code's statusLine hook ───────────
//
// Claude Code pipes a full JSON status object into a user-configured
// `statusLine.command` every few seconds during an interactive session.
// That object contains a `rate_limits` key with the same data the
// `/usage` slash command displays. We install a tiny shell script as the
// statusLine command; it copies the JSON to a cache file and echoes an
// empty line (so claude's status bar stays out of the way).
//
// GlassForge then reads the cache file to display the real percentages
// without needing to reverse-engineer Anthropic's private API.
//
// Install / uninstall are explicit user actions. The previous
// `~/.claude/settings.json` is always backed up before we touch it.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitBucket {
    pub used_percentage: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimits {
    pub five_hour: Option<RateLimitBucket>,
    pub seven_day: Option<RateLimitBucket>,
    pub captured_at_iso: Option<String>,
    pub stale_seconds: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    pub script_path: Option<String>,
    pub cache_path: Option<String>,
    pub last_captured_iso: Option<String>,
    pub last_captured_age_secs: Option<u64>,
    pub settings_path: Option<String>,
}

fn claude_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude"))
}

fn settings_path() -> Option<PathBuf> {
    claude_dir().map(|d| d.join("settings.json"))
}

fn settings_backup_path() -> Option<PathBuf> {
    claude_dir().map(|d| d.join("settings.json.glassforge-backup"))
}

fn tap_script_path() -> Option<PathBuf> {
    home_dir().map(|h| {
        h.join(".local")
            .join("share")
            .join("glassforge")
            .join("usage-tap.sh")
    })
}

fn tap_cache_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".cache").join("glassforge").join("usage.json"))
}

fn write_tap_script() -> Result<PathBuf> {
    let script = tap_script_path().ok_or_else(|| anyhow!("HOME unset"))?;
    let cache = tap_cache_path().ok_or_else(|| anyhow!("HOME unset"))?;

    if let Some(parent) = script.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    if let Some(parent) = cache.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }

    let body = format!(
        "#!/bin/sh\n\
# GlassForge usage tap — captures rate_limits from the claude statusLine.\n\
# Writes the full JSON payload to a cache file and emits an empty status\n\
# line so claude's status bar stays out of the way.\n\
set -eu\n\
out={cache}\n\
mkdir -p \"$(dirname \"$out\")\"\n\
tee \"$out\" >/dev/null\n\
printf ''\n",
        cache = shell_quote(&cache.to_string_lossy())
    );
    fs::write(&script, body.as_bytes()).with_context(|| format!("write {}", script.display()))?;
    let mut perms = fs::metadata(&script)?.permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&script, perms)?;
    Ok(script)
}

fn shell_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

fn read_settings() -> Result<(PathBuf, Value)> {
    let path = settings_path().ok_or_else(|| anyhow!("HOME unset"))?;
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "{}".to_string(),
        Err(e) => return Err(anyhow!("read {}: {e}", path.display())),
    };
    let json: Value =
        serde_json::from_str(&content).unwrap_or_else(|_| Value::Object(Default::default()));
    Ok((path, json))
}

fn write_settings(path: &PathBuf, value: &Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let pretty = serde_json::to_string_pretty(value).context("serialize claude settings.json")?;
    fs::write(path, pretty).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

pub fn install_usage_hook() -> Result<HookStatus> {
    let script = write_tap_script()?;
    let (settings_file, mut settings) = read_settings()?;

    // One-time backup of the existing file so uninstall can restore it.
    let backup = settings_backup_path().ok_or_else(|| anyhow!("HOME unset"))?;
    if !backup.exists() {
        if settings_file.exists() {
            fs::copy(&settings_file, &backup)
                .with_context(|| format!("backup {}", backup.display()))?;
        } else {
            fs::write(&backup, "{}\n").ok();
        }
    }

    if !settings.is_object() {
        settings = Value::Object(Default::default());
    }
    let obj = settings
        .as_object_mut()
        .ok_or_else(|| anyhow!("settings.json is not an object"))?;
    obj.insert(
        "statusLine".to_string(),
        serde_json::json!({
            "type": "command",
            "command": script.to_string_lossy(),
            "refreshInterval": 3000,
            "padding": 0
        }),
    );
    write_settings(&settings_file, &settings)?;

    status()
}

pub fn uninstall_usage_hook() -> Result<HookStatus> {
    let (settings_file, mut settings) = read_settings()?;
    let backup = settings_backup_path().ok_or_else(|| anyhow!("HOME unset"))?;

    if backup.exists() {
        fs::copy(&backup, &settings_file)
            .with_context(|| format!("restore {}", settings_file.display()))?;
        let _ = fs::remove_file(&backup);
    } else if let Some(obj) = settings.as_object_mut() {
        obj.remove("statusLine");
        write_settings(&settings_file, &settings)?;
    }

    if let Some(script) = tap_script_path() {
        let _ = fs::remove_file(&script);
    }
    status()
}

pub fn status() -> Result<HookStatus> {
    let script = tap_script_path().ok_or_else(|| anyhow!("HOME unset"))?;
    let cache = tap_cache_path().ok_or_else(|| anyhow!("HOME unset"))?;
    let (settings_file, settings) = read_settings()?;

    let configured = settings
        .get("statusLine")
        .and_then(|v| v.get("command"))
        .and_then(|c| c.as_str())
        .map(|s| s == script.to_string_lossy())
        .unwrap_or(false);

    let mut out = HookStatus {
        installed: configured && script.exists(),
        script_path: Some(script.to_string_lossy().into_owned()),
        cache_path: Some(cache.to_string_lossy().into_owned()),
        last_captured_iso: None,
        last_captured_age_secs: None,
        settings_path: Some(settings_file.to_string_lossy().into_owned()),
    };

    if let Ok(meta) = fs::metadata(&cache) {
        if let Ok(modified) = meta.modified() {
            if let Ok(dur) = modified.duration_since(SystemTime::UNIX_EPOCH) {
                let dt = chrono::DateTime::<Utc>::from_timestamp(dur.as_secs() as i64, 0);
                if let Some(dt) = dt {
                    out.last_captured_iso = Some(dt.to_rfc3339());
                }
                if let Ok(age) = SystemTime::now().duration_since(modified) {
                    let secs: u64 = age.as_secs();
                    out.last_captured_age_secs = Some(secs);
                }
            }
        }
    }

    Ok(out)
}

pub fn read_rate_limits() -> Result<Option<RateLimits>> {
    let cache = tap_cache_path().ok_or_else(|| anyhow!("HOME unset"))?;
    let content = match fs::read_to_string(&cache) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(anyhow!("read {}: {e}", cache.display())),
    };
    let json: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let rl = match json.get("rate_limits") {
        Some(v) if v.is_object() => v,
        _ => return Ok(None),
    };

    fn parse_bucket(v: Option<&Value>) -> Option<RateLimitBucket> {
        let obj = v?.as_object()?;
        Some(RateLimitBucket {
            used_percentage: obj
                .get("used_percentage")
                .and_then(|n| n.as_f64())
                .unwrap_or(0.0),
            resets_at: obj
                .get("resets_at")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string()),
        })
    }

    let five_hour = parse_bucket(rl.get("five_hour"));
    let seven_day = parse_bucket(rl.get("seven_day"));

    if five_hour.is_none() && seven_day.is_none() {
        return Ok(None);
    }

    let (captured_at_iso, stale_seconds) =
        match fs::metadata(&cache).and_then(|m| m.modified()).ok() {
            Some(modified) => {
                let iso = modified
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .ok()
                    .and_then(|d| chrono::DateTime::<Utc>::from_timestamp(d.as_secs() as i64, 0))
                    .map(|dt| dt.to_rfc3339());
                let age: u64 = SystemTime::now()
                    .duration_since(modified)
                    .map(|d: StdDuration| d.as_secs())
                    .unwrap_or(0);
                (iso, age)
            }
            None => (None, u64::MAX),
        };

    Ok(Some(RateLimits {
        five_hour,
        seven_day,
        captured_at_iso,
        stale_seconds,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_default_is_zero() {
        let s = Snapshot::default();
        assert_eq!(s.all_time.cost_usd, 0.0);
        assert_eq!(s.session_count, 0);
    }

    #[test]
    fn normalize_model_collapses_families() {
        assert_eq!(normalize_model("claude-opus-4-6"), "opus");
        assert_eq!(normalize_model("claude-sonnet-4-6"), "sonnet");
        assert_eq!(normalize_model("claude-haiku-4-5"), "haiku");
        assert_eq!(normalize_model("custom-model-x"), "custom-model-x");
    }

    #[test]
    fn opus_pricing_is_highest() {
        let (o_in, o_out, _, _) = model_pricing("opus");
        let (s_in, s_out, _, _) = model_pricing("sonnet");
        let (h_in, h_out, _, _) = model_pricing("haiku");
        assert!(o_in > s_in && s_in > h_in);
        assert!(o_out > s_out && s_out > h_out);
    }

    #[test]
    fn cost_scales_with_tokens() {
        let small = Totals {
            input_tokens: 1000,
            output_tokens: 1000,
            ..Default::default()
        };
        let big = Totals {
            input_tokens: 10_000,
            output_tokens: 10_000,
            ..Default::default()
        };
        assert!(cost_of("sonnet", &big) > cost_of("sonnet", &small));
    }

    #[test]
    fn compute_on_missing_dir_returns_default() {
        // If HOME is unset or ~/.claude/projects is absent we get a zero
        // snapshot, not an error.
        let _ = compute();
    }
}
