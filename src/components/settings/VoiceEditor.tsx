import { invoke } from "@tauri-apps/api/core";

import { Dropdown, type DropdownOption } from "@/components/ui/Dropdown";
import * as log from "@/lib/log";
import {
  usePreferencesStore,
  type VoiceModel,
} from "@/stores/preferencesStore";
import styles from "./ThemeEditor.module.css";

const MODEL_OPTIONS: DropdownOption<VoiceModel>[] = [
  { label: "Tiny — très rapide, précision faible", value: "tiny" },
  { label: "Base — rapide, précision correcte", value: "base" },
  { label: "Small — équilibré", value: "small" },
  { label: "Medium — plus précis, plus lent", value: "medium" },
  {
    label: "Distil Large v3 — qualité haute, rapide (recommandé)",
    value: "distil-large-v3",
  },
  {
    label: "Large v3 Turbo — qualité élevée, rapide",
    value: "large-v3-turbo",
  },
  { label: "Large v3 — qualité maximale, lent sans GPU", value: "large-v3" },
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
  const voiceVolume = usePreferencesStore((s) => s.voiceVolume);
  const setVoiceVolume = usePreferencesStore((s) => s.setVoiceVolume);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Voice</h3>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Raccourci
          <span className={styles.hint}>
            Appuyez sur Ctrl+Alt+O pour activer/désactiver la commande vocale.
          </span>
        </div>
        <div className={styles.rowControl}>
          <kbd style={{ fontSize: 11, opacity: 0.7 }}>Ctrl+Alt+O</kbd>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          Modèle Whisper
          <span className={styles.hint}>
            La première utilisation de chaque modèle télécharge les poids
            (~150 Mo pour base, ~1.5 Go pour les Large). Le sidecar utilise
            le GPU automatiquement si CUDA est disponible.
          </span>
        </div>
        <div className={styles.rowControl}>
          <Dropdown
            size="sm"
            ariaLabel="Modèle Whisper"
            options={MODEL_OPTIONS}
            value={voiceModel}
            onChange={(v) => {
              void setVoiceModel(v);
              invoke("voice_set_model", { model: v }).catch((e) =>
                log.warn("voice_set_model failed", e),
              );
            }}
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
          Volume
          <span className={styles.hint}>
            Volume de la voix de synthèse (piper).
          </span>
        </div>
        <div className={styles.rowControl}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={voiceVolume}
            onChange={(e) => void setVoiceVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 6 }}>
            {Math.round(voiceVolume * 100)}%
          </span>
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
