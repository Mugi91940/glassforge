//! Image attachment plumbing.
//!
//! Two operations the frontend needs:
//!
//! * Preview a file already on disk (file picker, native drag-drop): we
//!   read it back and return a `data:` URL so the renderer can drop it
//!   straight into an `<img>` without going through the asset protocol.
//!
//! * Capture a clipboard paste: the browser hands us raw bytes, we write
//!   them to a temp file, and return the path so the compose can inject
//!   `@/tmp/…` into the outgoing message (same convention as the CLI).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

/// Cap clipboard pastes at a generous 32 MiB — anything larger is
/// almost certainly a mistake (or an attempt to DoS us) and claude
/// wouldn't accept it anyway.
const MAX_CLIPBOARD_IMAGE_BYTES: usize = 32 * 1024 * 1024;

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn mime_from_extension(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "heic" => "image/heic",
        _ => "application/octet-stream",
    }
}

fn sanitize_extension(ext: &str) -> String {
    let trimmed = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if trimmed.is_empty() || trimmed.len() > 8 || !trimmed.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return "png".to_string();
    }
    trimmed
}

/// Write bytes from the frontend (typically a clipboard paste) to a
/// temp file with a glassforge-scoped prefix so cleanup scripts can
/// find our leftovers. Returns the absolute path the compose will
/// reference via `@/tmp/…`.
pub fn save_bytes_to_temp(bytes: Vec<u8>, extension: &str) -> Result<PathBuf> {
    if bytes.is_empty() {
        return Err(anyhow!("clipboard image is empty"));
    }
    if bytes.len() > MAX_CLIPBOARD_IMAGE_BYTES {
        return Err(anyhow!(
            "clipboard image too large: {} bytes (max {})",
            bytes.len(),
            MAX_CLIPBOARD_IMAGE_BYTES
        ));
    }
    let ext = sanitize_extension(extension);
    let filename = format!("glassforge-paste-{}.{}", now_nanos(), ext);
    let path = std::env::temp_dir().join(filename);
    let mut file = fs::File::create(&path)
        .with_context(|| format!("create temp file {}", path.display()))?;
    file.write_all(&bytes)
        .with_context(|| format!("write temp file {}", path.display()))?;
    Ok(path)
}

/// Read a file back into a `data:<mime>;base64,…` URL for preview. We
/// don't guess MIME from the content — the extension is authoritative
/// and consistent with what we write for pastes.
pub fn read_as_data_url(path: &Path) -> Result<String> {
    if !path.is_file() {
        return Err(anyhow!("not a file: {}", path.display()));
    }
    let bytes = fs::read(path).with_context(|| format!("read {}", path.display()))?;
    // Mirror the clipboard cap so a 200 MiB RAW dropped from a file
    // manager doesn't stall the renderer inlining it.
    if bytes.len() > MAX_CLIPBOARD_IMAGE_BYTES {
        return Err(anyhow!(
            "image too large to preview: {} bytes",
            bytes.len()
        ));
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let mime = mime_from_extension(ext);
    let encoded = BASE64.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_extension_strips_dot_and_defaults() {
        assert_eq!(sanitize_extension(".PNG"), "png");
        assert_eq!(sanitize_extension("jpg"), "jpg");
        assert_eq!(sanitize_extension(""), "png");
        assert_eq!(sanitize_extension("../../etc"), "png");
        assert_eq!(sanitize_extension("jpegtoolong"), "png");
    }

    #[test]
    fn mime_defaults_to_octet_stream_for_unknown() {
        assert_eq!(mime_from_extension("xyz"), "application/octet-stream");
        assert_eq!(mime_from_extension("PNG"), "image/png");
    }

    #[test]
    fn save_and_read_round_trip() {
        let bytes = b"\x89PNG\r\n\x1a\n fake payload".to_vec();
        let path = save_bytes_to_temp(bytes.clone(), "png").unwrap();
        assert!(path.exists());
        let data_url = read_as_data_url(&path).unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn save_rejects_empty_bytes() {
        assert!(save_bytes_to_temp(vec![], "png").is_err());
    }
}
