import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

import * as log from "@/lib/log";
import type { CatalogEntry, Scope } from "@/lib/types";

type TypeFilter = "all" | "skill" | "plugin";
type StatusFilter = "all" | "installed" | "available" | "updates";

type CatalogState = {
  entries: CatalogEntry[];
  loading: boolean;
  searchQuery: string;
  typeFilter: TypeFilter;
  statusFilter: StatusFilter;

  selectedEntry: CatalogEntry | null;

  fetchCatalog: () => Promise<void>;
  install: (id: string, scope: Scope) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  changeScope: (id: string, scope: Scope) => Promise<void>;
  refreshMarketplaces: () => Promise<void>;
  addMarketplace: (repo: string) => Promise<void>;

  setSearchQuery: (q: string) => void;
  setTypeFilter: (f: TypeFilter) => void;
  setStatusFilter: (f: StatusFilter) => void;
  selectEntry: (entry: CatalogEntry | null) => void;

  filteredEntries: () => CatalogEntry[];
  updateCount: () => number;
};

/**
 * Merge marketplace + installed entries: if the same id appears in both,
 * the installed version enriches the marketplace one.
 */
function mergeEntries(
  marketplace: CatalogEntry[],
  installed: CatalogEntry[],
): CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>();

  for (const e of marketplace) {
    byId.set(e.id, e);
  }

  for (const e of installed) {
    const existing = byId.get(e.id);
    if (existing) {
      // Enrich marketplace entry with installed info
      byId.set(e.id, {
        ...existing,
        installed: e.installed,
        version: e.version ?? existing.version,
        // Prefer marketplace metadata but fill gaps from installed
        description: existing.description || e.description,
        author: existing.author ?? e.author,
        license: existing.license ?? e.license,
        homepage: existing.homepage ?? e.homepage,
      });
    } else {
      byId.set(e.id, e);
    }
  }

  return Array.from(byId.values());
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  entries: [],
  loading: false,
  searchQuery: "",
  typeFilter: "all",
  statusFilter: "all",
  selectedEntry: null,

  fetchCatalog: async () => {
    set({ loading: true });
    try {
      const [marketplace, installed] = await Promise.all([
        invoke<CatalogEntry[]>("list_marketplace_entries"),
        invoke<CatalogEntry[]>("list_installed_plugins"),
      ]);
      const merged = mergeEntries(marketplace, installed);
      merged.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      set({ entries: merged, loading: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("fetchCatalog failed", msg);
      set({ loading: false });
    }
  },

  install: async (id, scope) => {
    try {
      await invoke("install_catalog_plugin", { name: id, scope });
      await get().fetchCatalog();
      // Refresh selectedEntry if it was the one we installed
      const selected = get().selectedEntry;
      if (selected?.id === id) {
        const updated = get().entries.find((e) => e.id === id) ?? null;
        set({ selectedEntry: updated });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("install failed", msg);
      throw e;
    }
  },

  uninstall: async (id) => {
    try {
      await invoke("uninstall_catalog_plugin", { name: id });
      await get().fetchCatalog();
      const selected = get().selectedEntry;
      if (selected?.id === id) {
        const updated = get().entries.find((e) => e.id === id) ?? null;
        set({ selectedEntry: updated });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("uninstall failed", msg);
      throw e;
    }
  },

  changeScope: async (id, scope) => {
    try {
      await invoke("change_catalog_plugin_scope", { pluginId: id, newScope: scope });
      await get().fetchCatalog();
      const selected = get().selectedEntry;
      if (selected?.id === id) {
        const updated = get().entries.find((e) => e.id === id) ?? null;
        set({ selectedEntry: updated });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("changeScope failed", msg);
      throw e;
    }
  },

  refreshMarketplaces: async () => {
    try {
      await invoke("refresh_catalog_marketplaces");
      await get().fetchCatalog();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("refreshMarketplaces failed (silent)", msg);
    }
  },

  addMarketplace: async (repo) => {
    try {
      await invoke("add_catalog_marketplace", { repo });
      await get().fetchCatalog();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("addMarketplace failed", msg);
      throw e;
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
  setTypeFilter: (f) => set({ typeFilter: f }),
  setStatusFilter: (f) => set({ statusFilter: f }),
  selectEntry: (entry) => set({ selectedEntry: entry }),

  filteredEntries: () => {
    const { entries, searchQuery, typeFilter, statusFilter } = get();
    const q = searchQuery.toLowerCase().trim();

    return entries.filter((e) => {
      // Type filter
      if (typeFilter === "skill" && e.entry_type !== "Skill") return false;
      if (typeFilter === "plugin" && e.entry_type !== "Plugin") return false;

      // Status filter
      if (statusFilter === "installed" && !e.installed) return false;
      if (statusFilter === "available" && e.installed) return false;
      if (statusFilter === "updates" && !e.installed?.has_update) return false;

      // Search query
      if (q) {
        const haystack = `${e.name} ${e.description} ${e.category ?? ""} ${(e.keywords ?? []).join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  },

  updateCount: () => {
    return get().entries.filter((e) => e.installed?.has_update).length;
  },
}));
