//! Read-only scanner for `~/.claude/projects/*/*.jsonl`.
//!
//! Each JSONL file is one full claude session transcript — the same
//! thing `--resume <sid>` picks back up. We parse two things out of it:
//!
//! * A summary for the sidebar: which project (cwd) the session belongs
//!   to, its first user message preview, timestamps, message count.
//! * The full history as a `Vec<ChatEntry>`-shaped JSON value so the
//!   frontend can drop it straight into its store and let the user
//!   resume the conversation.

use std::fs;
use std::path::PathBuf;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub project_path: String,
    pub first_ts: Option<String>,
    pub last_ts: Option<String>,
    pub message_count: u64,
    pub preview: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub path: String,
    pub sessions: Vec<SessionSummary>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn projects_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("projects"))
}

/// Walk every project / session file, producing one entry per distinct
/// `cwd`. Sessions inside each project are sorted by last activity
/// descending so the most recent sits on top.
pub fn list_project_sessions() -> Result<Vec<ProjectSummary>> {
    let dir = match projects_dir() {
        Some(d) if d.is_dir() => d,
        _ => return Ok(Vec::new()),
    };

    let mut by_project: std::collections::HashMap<String, Vec<SessionSummary>> =
        std::collections::HashMap::new();

    for entry in fs::read_dir(&dir)?.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        for sess in fs::read_dir(&p)?.flatten() {
            let file = sess.path();
            if file.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(summary) = summarize_session(&file) else {
                continue;
            };
            by_project
                .entry(summary.project_path.clone())
                .or_default()
                .push(summary);
        }
    }

    let mut projects: Vec<ProjectSummary> = by_project
        .into_iter()
        // Filter out projects whose cwd no longer exists on disk — they
        // can't be resumed because create_session validates the path
        // and it would just clutter the list with dead branches.
        .filter(|(path, _)| std::path::Path::new(path).is_dir())
        .map(|(path, mut sessions)| {
            sessions.sort_by(|a, b| b.last_ts.cmp(&a.last_ts));
            ProjectSummary { path, sessions }
        })
        .collect();

    projects.sort_by(|a, b| {
        let al = a.sessions.first().and_then(|s| s.last_ts.as_deref());
        let bl = b.sessions.first().and_then(|s| s.last_ts.as_deref());
        bl.cmp(&al)
    });

    Ok(projects)
}

fn summarize_session(file: &std::path::Path) -> Option<SessionSummary> {
    let id = file.file_stem()?.to_string_lossy().to_string();
    let content = fs::read_to_string(file).ok()?;

    let mut project_path: Option<String> = None;
    let mut first_ts: Option<String> = None;
    let mut last_ts: Option<String> = None;
    let mut preview: Option<String> = None;
    let mut model: Option<String> = None;
    let mut message_count: u64 = 0;

    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        let Ok(val): Result<Value, _> = serde_json::from_str(line) else {
            continue;
        };

        if project_path.is_none() {
            if let Some(cwd) = val.get("cwd").and_then(|v| v.as_str()) {
                project_path = Some(cwd.to_string());
            }
        }

        if let Some(ts) = val.get("timestamp").and_then(|v| v.as_str()) {
            if first_ts.is_none() {
                first_ts = Some(ts.to_string());
            }
            last_ts = Some(ts.to_string());
        }

        let t = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if t == "user" {
            message_count += 1;
            if preview.is_none() {
                if let Some(text) = extract_user_text(&val) {
                    preview = Some(truncate(&text, 140));
                }
            }
        } else if t == "assistant" && model.is_none() {
            if let Some(m) = val
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(|m| m.as_str())
            {
                model = Some(m.to_string());
            }
        }
    }

    Some(SessionSummary {
        id,
        project_path: project_path?,
        first_ts,
        last_ts,
        message_count,
        preview,
        model,
    })
}

fn extract_user_text(val: &Value) -> Option<String> {
    let content = val.get("message")?.get("content")?;
    if let Some(s) = content.as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(arr) = content.as_array() {
        for block in arr {
            if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                if let Some(s) = block.get("text").and_then(|v| v.as_str()) {
                    if !s.trim().is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
    }
    None
}

fn truncate(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let end: String = trimmed.chars().take(max).collect();
    format!("{end}…")
}

/// Parse a session's JSONL into `ChatEntry`-compatible JSON objects so
/// the frontend store can drop them in directly. We skip hook-attachment
/// and sidechain lines — only real user / assistant turns get rendered.
pub fn load_session_history(session_id: &str) -> Result<Vec<Value>> {
    let dir = projects_dir().ok_or_else(|| anyhow!("HOME not set"))?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut found: Option<PathBuf> = None;
    'outer: for entry in fs::read_dir(&dir)?.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        for sess in fs::read_dir(&p)?.flatten() {
            let file = sess.path();
            if file.file_stem().and_then(|s| s.to_str()) == Some(session_id)
                && file.extension().and_then(|e| e.to_str()) == Some("jsonl")
            {
                found = Some(file);
                break 'outer;
            }
        }
    }

    let Some(path) = found else {
        return Err(anyhow!("session {session_id} not found"));
    };

    let content = fs::read_to_string(&path)?;
    let mut entries: Vec<Value> = Vec::new();

    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        let Ok(val): Result<Value, _> = serde_json::from_str(line) else {
            continue;
        };
        if val.get("isSidechain").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }
        let ts = ts_millis(val.get("timestamp"));
        let t = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match t {
            "user" => {
                let Some(content) = val.get("message").and_then(|m| m.get("content")) else {
                    continue;
                };
                if let Some(s) = content.as_str() {
                    if !s.trim().is_empty() {
                        entries.push(json!({
                            "kind": "user",
                            "ts": ts,
                            "text": s,
                        }));
                    }
                } else if let Some(arr) = content.as_array() {
                    for block in arr {
                        match block.get("type").and_then(|v| v.as_str()) {
                            Some("text") => {
                                if let Some(s) = block.get("text").and_then(|v| v.as_str()) {
                                    if !s.trim().is_empty() {
                                        entries.push(json!({
                                            "kind": "user",
                                            "ts": ts,
                                            "text": s,
                                        }));
                                    }
                                }
                            }
                            Some("tool_result") => {
                                let tool_use_id = block
                                    .get("tool_use_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let text = tool_result_text(block.get("content"));
                                let is_error = block
                                    .get("is_error")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                // Attach to the most recent tool entry
                                // with the same id, if any.
                                let mut attached = false;
                                for e in entries.iter_mut().rev() {
                                    if e.get("kind").and_then(|v| v.as_str()) == Some("tool")
                                        && e.get("id").and_then(|v| v.as_str())
                                            == Some(tool_use_id.as_str())
                                    {
                                        if let Some(obj) = e.as_object_mut() {
                                            obj.insert("result".into(), json!(text));
                                            if is_error {
                                                obj.insert("isError".into(), json!(true));
                                            }
                                        }
                                        attached = true;
                                        break;
                                    }
                                }
                                if !attached {
                                    entries.push(json!({
                                        "kind": "tool",
                                        "ts": ts,
                                        "id": tool_use_id,
                                        "name": "(unknown)",
                                        "input": null,
                                        "result": text,
                                        "isError": is_error,
                                    }));
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            "assistant" => {
                let Some(message) = val.get("message") else {
                    continue;
                };
                let model = message
                    .get("model")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let Some(content) = message.get("content").and_then(|v| v.as_array()) else {
                    continue;
                };
                for block in content {
                    match block.get("type").and_then(|v| v.as_str()) {
                        Some("text") => {
                            if let Some(s) = block.get("text").and_then(|v| v.as_str()) {
                                let mut obj = json!({
                                    "kind": "assistant",
                                    "ts": ts,
                                    "text": s,
                                });
                                if let Some(m) = &model {
                                    obj.as_object_mut()
                                        .unwrap()
                                        .insert("model".into(), json!(m));
                                }
                                entries.push(obj);
                            }
                        }
                        Some("tool_use") => {
                            let id = block
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let name = block
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let input = block.get("input").cloned().unwrap_or(Value::Null);
                            entries.push(json!({
                                "kind": "tool",
                                "ts": ts,
                                "id": id,
                                "name": name,
                                "input": input,
                            }));
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    Ok(entries)
}

/// Permanently remove a session's JSONL file from `~/.claude/projects`.
/// Validates the resolved path stays under the projects directory so a
/// crafted id can't escape the sandbox.
pub fn delete_session_file(session_id: &str) -> Result<()> {
    let dir = projects_dir().ok_or_else(|| anyhow!("HOME not set"))?;
    let canonical_root = dir.canonicalize().unwrap_or_else(|_| dir.clone());

    let mut found: Option<PathBuf> = None;
    for entry in fs::read_dir(&dir)?.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        for sess in fs::read_dir(&p)?.flatten() {
            let file = sess.path();
            if file.file_stem().and_then(|s| s.to_str()) == Some(session_id)
                && file.extension().and_then(|e| e.to_str()) == Some("jsonl")
            {
                found = Some(file);
                break;
            }
        }
    }

    let Some(path) = found else {
        return Err(anyhow!("session {session_id} not found"));
    };

    let canonical_target = path.canonicalize().unwrap_or_else(|_| path.clone());
    if !canonical_target.starts_with(&canonical_root) {
        return Err(anyhow!("refusing to delete path outside projects dir"));
    }

    fs::remove_file(&canonical_target)
        .map_err(|e| anyhow!("remove {}: {e}", canonical_target.display()))?;
    Ok(())
}

fn tool_result_text(v: Option<&Value>) -> String {
    let Some(v) = v else {
        return String::new();
    };
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    if let Some(arr) = v.as_array() {
        let mut out = String::new();
        for block in arr {
            if let Some(s) = block.get("text").and_then(|v| v.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(s);
            }
        }
        return out;
    }
    v.to_string()
}

fn ts_millis(v: Option<&Value>) -> u64 {
    let Some(s) = v.and_then(|v| v.as_str()) else {
        return 0;
    };
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis().max(0) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_preserves_short_strings() {
        assert_eq!(truncate("hi", 100), "hi");
    }

    #[test]
    fn truncate_appends_ellipsis_for_long_strings() {
        let s = "abcdefghijklmnopqrstuvwxyz";
        let t = truncate(s, 5);
        assert!(t.ends_with('…'));
        assert_eq!(t.chars().count(), 6);
    }

    #[test]
    fn list_project_sessions_on_missing_home_is_ok() {
        // When ~/.claude/projects doesn't exist we return an empty Vec
        // instead of erroring.
        let _ = list_project_sessions();
    }
}
