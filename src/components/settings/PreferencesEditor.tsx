import { Dropdown, type DropdownOption } from "@/components/ui/Dropdown";
import {
  usePreferencesStore,
  type LongContextScope,
  type SmallFastModel,
} from "@/stores/preferencesStore";

import styles from "./ThemeEditor.module.css";

const SMALL_FAST_OPTIONS: DropdownOption<SmallFastModel>[] = [
  { label: "Auto (claude default)", value: "auto" },
  { label: "Haiku 4.5", value: "haiku" },
  { label: "Sonnet 4.6", value: "sonnet" },
  { label: "Opus 4.7", value: "opus" },
];

const LONG_CONTEXT_OPTIONS: DropdownOption<LongContextScope>[] = [
  { label: "None (200k everywhere)", value: "none" },
  { label: "Opus 1M only", value: "opus" },
  { label: "Opus + Sonnet 1M", value: "opus-sonnet" },
];

export function PreferencesEditor() {
  const smallFastModel = usePreferencesStore((s) => s.smallFastModel);
  const setSmallFastModel = usePreferencesStore((s) => s.setSmallFastModel);
  const longContextScope = usePreferencesStore((s) => s.longContextScope);
  const setLongContextScope = usePreferencesStore(
    (s) => s.setLongContextScope,
  );

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Context &amp; models</h3>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          1M context scope
          <span className={styles.hint}>
            Which model families you've unlocked for 1M context. Opus 1M
            ships with Max/Team plans; Sonnet 1M bills extra usage. Haiku
            has no 1M variant so it stays on 200k regardless. Claude
            doesn't mark 1M in its stream — the ring guesses from this
            setting and falls back to observation.
          </span>
        </div>
        <div className={styles.rowControl}>
          <Dropdown
            size="sm"
            ariaLabel="1M context scope"
            options={LONG_CONTEXT_OPTIONS}
            value={longContextScope}
            onChange={(v) => void setLongContextScope(v)}
          />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Small fast model
          <span className={styles.hint}>
            Used for auto-compact, background summaries, and cheap thinking
            (ANTHROPIC_SMALL_FAST_MODEL). Haiku keeps premium usage for the
            main turns. Pick "Auto" to let claude choose.
          </span>
        </div>
        <div className={styles.rowControl}>
          <Dropdown
            size="sm"
            ariaLabel="Small fast model"
            options={SMALL_FAST_OPTIONS}
            value={smallFastModel}
            onChange={(v) => void setSmallFastModel(v)}
          />
        </div>
      </div>
    </section>
  );
}
