//! Unified catalog: merges marketplace plugins, installed plugins, and
//! standalone skills into a single `Vec<CatalogEntry>`.

pub mod types;

mod actions;
mod installed;
mod marketplace;

pub use actions::{
    add_marketplace, change_plugin_scope, install_plugin, refresh_marketplaces, uninstall_entry,
};
pub use installed::list_installed;
pub use marketplace::list_marketplace_entries;
pub use types::{CatalogEntry, Scope};
