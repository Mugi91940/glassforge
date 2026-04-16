import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";

import * as log from "@/lib/log";
import { useCatalogStore } from "@/stores/catalogStore";

import { CatalogListItem } from "./CatalogListItem";
import { FilterPills } from "./FilterPills";
import { SearchBar } from "./SearchBar";
import styles from "./SkillsPanel.module.css";

export function SkillsPanel() {
  const loading = useCatalogStore((s) => s.loading);
  const allEntries = useCatalogStore((s) => s.entries);
  const searchQuery = useCatalogStore((s) => s.searchQuery);
  const typeFilter = useCatalogStore((s) => s.typeFilter);
  const statusFilter = useCatalogStore((s) => s.statusFilter);
  const selectedEntry = useCatalogStore((s) => s.selectedEntry);
  const fetchCatalog = useCatalogStore((s) => s.fetchCatalog);
  const refreshMarketplaces = useCatalogStore((s) => s.refreshMarketplaces);
  const addMarketplace = useCatalogStore((s) => s.addMarketplace);
  const setSearchQuery = useCatalogStore((s) => s.setSearchQuery);
  const setTypeFilter = useCatalogStore((s) => s.setTypeFilter);
  const setStatusFilter = useCatalogStore((s) => s.setStatusFilter);
  const selectEntry = useCatalogStore((s) => s.selectEntry);
  const filteredEntries = useCatalogStore((s) => s.filteredEntries);
  const updateCount = useCatalogStore((s) => s.updateCount);

  const entries = filteredEntries();
  const updates = updateCount();
  const listRef = useRef<HTMLDivElement>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addRepo, setAddRepo] = useState("");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  useEffect(() => {
    void fetchCatalog().then(() => {
      void refreshMarketplaces();
    });
  }, [fetchCatalog, refreshMarketplaces]);

  const installed = entries.filter((e) => e.installed != null);
  const available = entries.filter((e) => e.installed == null);
  const flatList = [...installed, ...available];
  const hasFilters = searchQuery || typeFilter !== "all" || statusFilter !== "all";

  function clearFilters() {
    setSearchQuery("");
    setTypeFilter("all");
    setStatusFilter("all");
  }

  async function handleAddMarketplace() {
    const repo = addRepo.trim();
    if (!repo) return;
    setAdding(true);
    setAddErr(null);
    try {
      await addMarketplace(repo);
      setAddRepo("");
      setAddOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAddErr(msg);
      log.error("add marketplace failed", msg);
    } finally {
      setAdding(false);
    }
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (flatList.length === 0) return;

      const currentIndex = selectedEntry
        ? flatList.findIndex((f) => f.id === selectedEntry.id)
        : -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIndex < flatList.length - 1 ? currentIndex + 1 : 0;
        selectEntry(flatList[next]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : flatList.length - 1;
        selectEntry(flatList[prev]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        selectEntry(null);
      }
    },
    [flatList, selectedEntry, selectEntry],
  );

  const isEmpty = !loading && allEntries.length === 0;

  return (
    <div
      className={styles.root}
      ref={listRef}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <SearchBar value={searchQuery} onChange={setSearchQuery} />
      <FilterPills
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        updateCount={updates}
        onTypeChange={setTypeFilter}
        onStatusChange={setStatusFilter}
      />

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => setAddOpen(!addOpen)}
          aria-label="Add marketplace"
          title="Add marketplace source"
        >
          <Plus size={11} />
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => void refreshMarketplaces()}
          aria-label="Refresh marketplaces"
          title="Refresh marketplace catalogs"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {addOpen ? (
        <div className={styles.addForm}>
          <input
            className={styles.addInput}
            type="text"
            placeholder="owner/repo"
            value={addRepo}
            onChange={(e) => setAddRepo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddMarketplace();
              if (e.key === "Escape") setAddOpen(false);
              e.stopPropagation();
            }}
            spellCheck={false}
            autoComplete="off"
            disabled={adding}
            autoFocus
          />
          <button
            type="button"
            className={styles.addButton}
            onClick={() => void handleAddMarketplace()}
            disabled={adding || !addRepo.trim()}
          >
            {adding ? <Loader2 size={12} className={styles.spin} /> : "Add"}
          </button>
          {addErr ? <p className={styles.addError}>{addErr}</p> : null}
        </div>
      ) : null}

      {loading ? (
        <div className={styles.skeletons}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      ) : isEmpty ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            No marketplaces configured. Click <strong>+</strong> above to add one,
            or try:
          </p>
          <code className={styles.cliCommand}>
            anthropics/claude-plugins-official
          </code>
        </div>
      ) : entries.length === 0 && hasFilters ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>No matches found.</p>
          <button
            type="button"
            className={styles.clearFilters}
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className={styles.list}>
          {installed.length > 0 ? (
            <section>
              <h3 className={styles.sectionHeader}>
                Installed · {installed.length}
              </h3>
              {installed.map((e) => (
                <CatalogListItem
                  key={e.id}
                  entry={e}
                  selected={selectedEntry?.id === e.id}
                  onSelect={selectEntry}
                />
              ))}
            </section>
          ) : null}
          {available.length > 0 ? (
            <section>
              <h3 className={styles.sectionHeader}>
                Available · {available.length}
              </h3>
              {available.map((e) => (
                <CatalogListItem
                  key={e.id}
                  entry={e}
                  selected={selectedEntry?.id === e.id}
                  onSelect={selectEntry}
                />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
