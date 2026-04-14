import { PRESETS, type ThemeVars } from "@/lib/theme";
import { useThemeStore } from "@/stores/themeStore";

import styles from "./ThemeEditor.module.css";

const FONT_SANS_OPTIONS: { label: string; value: string }[] = [
  {
    label: "Geist / Inter",
    value:
      '"Geist", "Inter", "SF Pro Display", system-ui, sans-serif',
  },
  { label: "Inter", value: '"Inter", system-ui, sans-serif' },
  { label: "System", value: "system-ui, sans-serif" },
];

const FONT_MONO_OPTIONS: { label: string; value: string }[] = [
  {
    label: "Geist Mono",
    value:
      '"Geist Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace',
  },
  {
    label: "JetBrains Mono",
    value: '"JetBrains Mono", ui-monospace, monospace',
  },
  { label: "Fira Code", value: '"Fira Code", ui-monospace, monospace' },
  { label: "System mono", value: "ui-monospace, monospace" },
];

export function ThemeEditor() {
  const vars = useThemeStore((s) => s.vars);
  const presetId = useThemeStore((s) => s.presetId);
  const setPreset = useThemeStore((s) => s.setPreset);
  const patch = useThemeStore((s) => s.patch);
  const reset = useThemeStore((s) => s.reset);

  function patchFn<K extends keyof ThemeVars>(key: K) {
    return (value: ThemeVars[K]) => void patch({ [key]: value } as Partial<ThemeVars>);
  }

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Preset</h3>
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.preset} ${
                presetId === p.id ? styles.presetActive : ""
              }`}
              onClick={() => void setPreset(p.id)}
            >
              <span
                className={styles.swatch}
                style={{
                  background: `linear-gradient(135deg, ${p.vars.accentPrimary}, ${p.vars.accentSecondary})`,
                }}
              />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Accent &amp; glow</h3>
        <ColorRow
          label="Primary accent"
          value={vars.accentPrimary}
          onChange={patchFn("accentPrimary")}
        />
        <ColorRow
          label="Secondary accent"
          value={vars.accentSecondary}
          onChange={patchFn("accentSecondary")}
        />
        <SliderRow
          label="Glow opacity"
          value={vars.accentGlowOpacity}
          min={0}
          max={0.25}
          step={0.005}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={patchFn("accentGlowOpacity")}
        />
        <SliderRow
          label="Glow radius"
          value={vars.accentGlowRadius}
          min={200}
          max={800}
          step={20}
          format={(v) => `${v}px`}
          onChange={patchFn("accentGlowRadius")}
        />
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Glass &amp; blur</h3>
        <SliderRow
          label="Blur strength"
          value={vars.glassBlur}
          min={0}
          max={80}
          step={1}
          format={(v) => `${v}px`}
          onChange={patchFn("glassBlur")}
        />
        <SliderRow
          label="Saturation"
          value={vars.glassSaturation}
          min={1}
          max={2.5}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={patchFn("glassSaturation")}
        />
        <SliderRow
          label="Glass bg opacity"
          value={vars.glassBgOpacity}
          min={0}
          max={0.2}
          step={0.005}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={patchFn("glassBgOpacity")}
        />
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Window</h3>
        <ColorRow
          label="Background"
          value={vars.bgPrimary}
          onChange={patchFn("bgPrimary")}
        />
        <SliderRow
          label="Window bg opacity"
          value={vars.windowBgOpacity}
          min={0.5}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={patchFn("windowBgOpacity")}
        />
        <CheckboxRow
          label="Enable KDE blur behind window"
          value={vars.kdeBlurEnabled}
          onChange={patchFn("kdeBlurEnabled")}
          hint="Requires KDE Plasma. Restart after toggling."
        />
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Typography</h3>
        <SelectRow
          label="Sans"
          value={vars.fontSans}
          options={FONT_SANS_OPTIONS}
          onChange={patchFn("fontSans")}
        />
        <SelectRow
          label="Mono"
          value={vars.fontMono}
          options={FONT_MONO_OPTIONS}
          onChange={patchFn("fontMono")}
        />
        <SliderRow
          label="Base size"
          value={vars.fontSizeBase}
          min={12}
          max={18}
          step={1}
          format={(v) => `${v}px`}
          onChange={patchFn("fontSizeBase")}
        />
        <SliderRow
          label="Corner radius"
          value={vars.radiusMd}
          min={4}
          max={24}
          step={1}
          format={(v) => `${v}px`}
          onChange={patchFn("radiusMd")}
        />
      </section>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.reset}
          onClick={() => void reset()}
        >
          Reset to Dark Glass
        </button>
      </div>
    </div>
  );
}

type RowProps<T> = {
  label: string;
  value: T;
  onChange: (v: T) => void;
};

function ColorRow({ label, value, onChange }: RowProps<string>) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowControl}>
        <input
          type="color"
          className={styles.color}
          value={toHex(value)}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className={styles.rowValue}>{value}</span>
      </span>
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: RowProps<number> & {
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowControl}>
        <input
          type="range"
          className={styles.slider}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className={styles.rowValue}>{format(value)}</span>
      </span>
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: RowProps<string> & { options: { label: string; value: string }[] }) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.label} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxRow({
  label,
  value,
  onChange,
  hint,
}: RowProps<boolean> & { hint?: string }) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>
        {label}
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

// Convert an arbitrary CSS color to a `#rrggbb` string so the native
// color picker accepts it. Falls back to the input if parsing fails.
function toHex(input: string): string {
  if (input.startsWith("#")) {
    if (input.length === 7) return input;
    if (input.length === 4) {
      return (
        "#" +
        input
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      );
    }
  }
  if (typeof document === "undefined") return "#000000";
  const el = document.createElement("span");
  el.style.color = input;
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color;
  document.body.removeChild(el);
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#000000";
  const r = Number(m[1]).toString(16).padStart(2, "0");
  const g = Number(m[2]).toString(16).padStart(2, "0");
  const b = Number(m[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}
