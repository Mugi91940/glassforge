import { Dropdown, type DropdownOption } from "@/components/ui/Dropdown";
import { usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./ThemeEditor.module.css";

const MODEL_OPTIONS: DropdownOption<"tiny" | "base" | "small" | "medium">[] = [
  { label: "Tiny (rapide, moins précis)", value: "tiny" },
  { label: "Base (recommandé)", value: "base" },
  { label: "Small", value: "small" },
  { label: "Medium (lent, plus précis)", value: "medium" },
];

const LANG_OPTIONS: DropdownOption<"fr" | "en">[] = [
  { label: "Français", value: "fr" },
  { label: "English", value: "en" },
];

export function VoiceEditor() {
  const voiceModel = usePreferencesStore((s) => s.voiceModel);
  const setVoiceModel = usePreferencesStore((s) => s.setVoiceModel);
  const voiceLang = usePreferencesStore((s) => s.voiceLang);
  const setVoiceLang = usePreferencesStore((s) => s.setVoiceLang);
  const voiceAutoSpeak = usePreferencesStore((s) => s.voiceAutoSpeak);
  const setVoiceAutoSpeak = usePreferencesStore((s) => s.setVoiceAutoSpeak);
  const voiceHudDuration = usePreferencesStore((s) => s.voiceHudDuration);
  const setVoiceHudDuration = usePreferencesStore((s) => s.setVoiceHudDuration);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Voice</h3>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Raccourci
          <span className={styles.hint}>
            Appuyez sur Super+V pour activer/désactiver la commande vocale.
          </span>
        </div>
        <div className={styles.rowControl}>
          <kbd style={{ fontSize: 11, opacity: 0.7 }}>Super + V</kbd>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Modèle Whisper
          <span className={styles.hint}>
            Base offre le meilleur compromis vitesse/précision.
          </span>
        </div>
        <div className={styles.rowControl}>
          <Dropdown
            size="sm"
            ariaLabel="Modèle Whisper"
            options={MODEL_OPTIONS}
            value={voiceModel}
            onChange={(v) => void setVoiceModel(v)}
          />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>Langue</div>
        <div className={styles.rowControl}>
          <Dropdown
            size="sm"
            ariaLabel="Langue"
            options={LANG_OPTIONS}
            value={voiceLang}
            onChange={(v) => void setVoiceLang(v)}
          />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Réponse vocale auto
          <span className={styles.hint}>
            Lire les réponses de Claude à voix haute.
          </span>
        </div>
        <div className={styles.rowControl}>
          <input
            type="checkbox"
            checked={voiceAutoSpeak}
            onChange={(e) => void setVoiceAutoSpeak(e.target.checked)}
            aria-label="Réponse vocale auto"
          />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Durée HUD
          <span className={styles.hint}>
            Secondes avant fermeture automatique du HUD.
          </span>
        </div>
        <div className={styles.rowControl}>
          <input
            type="range"
            min={2}
            max={8}
            step={1}
            value={voiceHudDuration}
            onChange={(e) => void setVoiceHudDuration(Number(e.target.value))}
            aria-label="Durée HUD"
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 6 }}>
            {voiceHudDuration}s
          </span>
        </div>
      </div>
    </section>
  );
}
