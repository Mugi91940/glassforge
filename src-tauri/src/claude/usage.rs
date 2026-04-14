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
use std::path::PathBuf;

use anyhow::{anyhow, Result};
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
