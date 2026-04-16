import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, RefreshCw } from "lucide-react";

import * as log from "@/lib/log";

import styles from "./SkillsPanel.module.css";

type Skill = {
  name: string;
  description: string;
  path: string;
  source: string;
};

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [installUrl, setInstallUrl] = useState("");
  const [installing, setInstalling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await invoke<Skill[]>("list_skills");
      setSkills(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      log.error("list_skills failed", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onInstall() {
    const url = installUrl.trim();
    if (!url) return;
    setInstalling(true);
    setErr(null);
    try {
      await invoke<Skill>("install_skill", { url });
      setInstallUrl("");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      log.error("install_skill failed", msg);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.installBox}>
        <label className={styles.label} htmlFor="install-url">
          Install from git
        </label>
        <div className={styles.inputRow}>
          <input
            id="install-url"
            className={styles.input}
            type="text"
            placeholder="https://github.com/user/skill"
            value={installUrl}
            onChange={(e) => setInstallUrl(e.target.value)}
            spellCheck={false}
            disabled={installing}
          />
          <button
            type="button"
            className={styles.installButton}
            onClick={onInstall}
            disabled={installing || !installUrl.trim()}
            aria-label="Install skill"
          >
            <Download size={14} />
          </button>
        </div>
        {err ? <p className={styles.error}>{err}</p> : null}
      </div>

      <div className={styles.header}>
        <span className={styles.headerLabel}>
          Installed{skills.length ? ` · ${skills.length}` : ""}
        </span>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void load()}
          aria-label="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : skills.length === 0 ? (
        <p className={styles.empty}>
          No skills found. Install one by entering a package name above, or
          check the Claude Code docs for available skills.
        </p>
      ) : (
        <ul className={styles.list}>
          {skills.map((s) => (
            <li key={s.path} className={styles.skillCard}>
              <div className={styles.skillName}>{s.name}</div>
              {s.description ? (
                <div className={styles.skillDescription}>{s.description}</div>
              ) : null}
              <div className={styles.skillPath} title={s.path}>
                {s.path}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
