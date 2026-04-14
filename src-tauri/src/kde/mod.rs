//! KDE Plasma compositor integration (window blur, panel hints).
//! Fully feature-gated to Linux.

#[cfg(target_os = "linux")]
pub mod blur;
