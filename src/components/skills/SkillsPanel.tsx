import { useCallback, useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";

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
  const setSearchQuery = useCatalogStore((s) => s.setSearchQuery);
  const setTypeFilter = useCatalogStore((s) => s.setTypeFilter);
  const setStatusFilter = useCatalogStore((s) => s.setStatusFilter);
  const selectEntry = useCatalogStore((s) => s.selectEntry);
  const filteredEntries = useCatalogStore((s) => s.filteredEntries);
  const updateCount = useCatalogStore((s) => s.updateCount);

  const entries = filteredEntries();
  const updates = updateCount();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchCatalog();
    void refreshMarketplaces();
  }, [fetchCatalog, refreshMarketplaces]);

  const installed = entries.filter((e) => e.installed != null);
  const available = entries.filter((e) => e.installed == null);

  // Flat list for keyboard navigation
  const flatList = [...installed, ...available];

  const hasFilters = searchQuery || typeFilter !== "all" || statusFilter !== "all";

  function clearFilters() {
    setSearchQuery("");
    setTypeFilter("all");
    setStatusFilter("all");
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

  // No marketplaces, no skills, nothing loaded — likely first use
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

      <div className={styles.refreshRow}>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void refreshMarketplaces()}
          aria-label="Refresh marketplaces"
          title="Refresh marketplace catalogs"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {loading ? (
        <div className={styles.skeletons}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      ) : isEmpty ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            No marketplaces configured. Add one with:
          </p>
          <code className={styles.cliCommand}>
            claude plugin marketplace add anthropics/claude-plugins-official
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
                  onClick={() => selectEntry(e)}
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
                  onClick={() => selectEntry(e)}
                />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
