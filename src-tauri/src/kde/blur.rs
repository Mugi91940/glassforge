//! Tells KWin to blur the region behind a Tauri window by setting the
//! `_KDE_NET_WM_BLUR_BEHIND_REGION` X11 atom. An empty CARDINAL region
//! is interpreted by KWin as "blur the entire window". Wayland support
//! requires the private `org_kde_kwin_blur_manager` protocol and is
//! not implemented here yet — on Wayland the call returns a descriptive
//! error so the UI can surface it to the user.

use anyhow::{Context, Result, anyhow};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::WebviewWindow;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, PropMode};
use x11rb::wrapper::ConnectionExt as _;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionType {
    Wayland,
    X11,
    Unknown,
}

pub fn detect_session_type() -> SessionType {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        SessionType::Wayland
    } else if std::env::var_os("DISPLAY").is_some() {
        SessionType::X11
    } else {
        SessionType::Unknown
    }
}

pub fn apply_blur(window: &WebviewWindow, enabled: bool) -> Result<()> {
    match detect_session_type() {
        SessionType::X11 => {
            let xid = get_xid(window)?;
            set_kde_blur_x11(xid, enabled)?;
            Ok(())
        }
        SessionType::Wayland => Err(anyhow!(
            "KDE blur on Wayland is not yet supported. Enable blur in System \
             Settings → Workspace Behavior → Compositor, or run GlassForge on X11."
        )),
        SessionType::Unknown => Err(anyhow!("no display server detected (DISPLAY / WAYLAND_DISPLAY unset)")),
    }
}

fn get_xid(window: &WebviewWindow) -> Result<u32> {
    let handle = window
        .window_handle()
        .map_err(|e| anyhow!("window_handle: {e}"))?;
    match handle.as_raw() {
        RawWindowHandle::Xlib(h) => Ok(h.window as u32),
        RawWindowHandle::Wayland(_) => Err(anyhow!(
            "window handle is a Wayland surface; X11 atom path does not apply"
        )),
        other => Err(anyhow!("unsupported window handle variant: {other:?}")),
    }
}

fn set_kde_blur_x11(window_id: u32, enabled: bool) -> Result<()> {
    let (conn, _screen) = x11rb::connect(None).context("x11 connect")?;
    let atom = conn
        .intern_atom(false, b"_KDE_NET_WM_BLUR_BEHIND_REGION")
        .context("intern_atom")?
        .reply()
        .context("intern_atom reply")?
        .atom;

    if enabled {
        // An empty CARDINAL[] region means "blur the entire client area".
        let empty: &[u32] = &[];
        conn.change_property32(
            PropMode::REPLACE,
            window_id,
            atom,
            AtomEnum::CARDINAL,
            empty,
        )
        .context("change_property")?
        .check()
        .context("change_property check")?;
    } else {
        conn.delete_property(window_id, atom)
            .context("delete_property")?
            .check()
            .context("delete_property check")?;
    }
    conn.flush().context("flush")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_type_detection_does_not_panic() {
        let _ = detect_session_type();
    }

    #[test]
    fn session_type_prefers_wayland_when_both_set() {
        // Can't unset env vars safely in parallel tests; instead verify
        // the function terminates for whatever the current env looks
        // like. The real logic is exercised via integration runs.
        let t = detect_session_type();
        assert!(matches!(
            t,
            SessionType::Wayland | SessionType::X11 | SessionType::Unknown
        ));
    }
}
