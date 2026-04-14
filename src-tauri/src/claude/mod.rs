//! Everything that talks to the `claude` CLI: session spawn, PTY IO,
//! streaming parser, usage/limits tracking.

pub mod history;
pub mod limits;
pub mod parser;
pub mod permissions;
pub mod session;
pub mod usage;

pub use session::{
    create_session, kill_session, list_sessions, remove_session, send_message, SessionInfo,
    SessionRegistry,
};
