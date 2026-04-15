// Runtime theme model. Every tunable is mapped to a CSS custom property
// on :root; `applyTheme` writes them all in one pass. Numbers carry units
// the serializer knows about — keeping the store free of `"40px"` strings.

export type ThemeVars = {
  bgPrimary: string;

  accentPrimary: string;
  accentSecondary: string;
  accentGlowOpacity: number;
  accentGlowRadius: number;

  glassBlur: number;
  glassSaturation: number;
  glassBgOpacity: number;

  windowBgOpacity: number;
  kdeBlurEnabled: boolean;
  kdeBlurStrength: number;

  modalDimAlpha: number;
  modalPanelAlpha: number;
  modalPanelBlur: number;

  fontSans: string;
  fontMono: string;
  fontSizeBase: number;
  radiusMd: number;
};

export const DEFAULT_THEME: ThemeVars = {
  bgPrimary: "#0a0319",

  accentPrimary: "#f472b6",
  accentSecondary: "#22d3ee",
  accentGlowOpacity: 0.14,
  accentGlowRadius: 608,

  glassBlur: 48,
  glassSaturation: 1.0,
  glassBgOpacity: 0.04,

  windowBgOpacity: 0.7,
  kdeBlurEnabled: false,
  kdeBlurStrength: 5,

  modalDimAlpha: 0.26,
  modalPanelAlpha: 0.38,
  modalPanelBlur: 16,

  fontSans:
    '"Geist", "Inter", "SF Pro Display", system-ui, sans-serif',
  fontMono:
    '"Geist Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace',
  fontSizeBase: 14,
  radiusMd: 12,
};

export type ThemePreset = {
  id: string;
  name: string;
  vars: ThemeVars;
};

export const PRESETS: ThemePreset[] = [
  {
    id: "dark-glass",
    name: "Dark Glass",
    vars: DEFAULT_THEME,
  },
  {
    id: "midnight-blue",
    name: "Midnight Blue",
    vars: {
      ...DEFAULT_THEME,
      bgPrimary: "#060b1a",
      accentPrimary: "#60a5fa",
      accentSecondary: "#22d3ee",
      accentGlowOpacity: 0.1,
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk Neon",
    vars: {
      ...DEFAULT_THEME,
      bgPrimary: "#0a0319",
      accentPrimary: "#f472b6",
      accentSecondary: "#22d3ee",
      accentGlowOpacity: 0.14,
      accentGlowRadius: 600,
      glassSaturation: 1.9,
    },
  },
  {
    id: "forest",
    name: "Forest",
    vars: {
      ...DEFAULT_THEME,
      bgPrimary: "#0a140c",
      accentPrimary: "#4ade80",
      accentSecondary: "#facc15",
      accentGlowOpacity: 0.09,
    },
  },
  {
    id: "nord",
    name: "Nord",
    vars: {
      ...DEFAULT_THEME,
      bgPrimary: "#2e3440",
      accentPrimary: "#88c0d0",
      accentSecondary: "#a3be8c",
      glassBgOpacity: 0.06,
      windowBgOpacity: 0.98,
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    vars: {
      ...DEFAULT_THEME,
      bgPrimary: "#282a36",
      accentPrimary: "#bd93f9",
      accentSecondary: "#50fa7b",
      accentGlowOpacity: 0.1,
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    vars: {
      ...DEFAULT_THEME,
      bgPrimary: "#1e1e2e",
      accentPrimary: "#cba6f7",
      accentSecondary: "#a6e3a1",
      accentGlowOpacity: 0.08,
    },
  },
];

export function applyTheme(vars: ThemeVars): void {
  const root = document.documentElement;
  const set = (k: string, v: string) => root.style.setProperty(k, v);

  set("--bg-primary", vars.bgPrimary);
  set("--bg-primary-rgb", hexToRgbTriplet(vars.bgPrimary));

  set("--accent-primary", vars.accentPrimary);
  set("--accent-secondary", vars.accentSecondary);
  set("--accent-glow-opacity", String(vars.accentGlowOpacity));
  set("--accent-glow-radius", `${vars.accentGlowRadius}px`);

  set("--glass-blur", `${vars.glassBlur}px`);
  set("--glass-saturation", String(vars.glassSaturation));
  set("--glass-bg", `rgba(255, 255, 255, ${vars.glassBgOpacity})`);

  set("--window-bg-opacity", String(vars.windowBgOpacity));

  set("--modal-dim-alpha", String(vars.modalDimAlpha));
  set("--modal-panel-alpha", String(vars.modalPanelAlpha));
  set("--modal-panel-blur", `${vars.modalPanelBlur}px`);

  set("--font-sans", vars.fontSans);
  set("--font-mono", vars.fontMono);
  set("--font-size-base", `${vars.fontSizeBase}px`);

  set("--radius-md", `${vars.radiusMd}px`);
  set("--radius-sm", `${Math.max(4, vars.radiusMd - 4)}px`);
  set("--radius-lg", `${vars.radiusMd + 4}px`);
}

// Accepts `#rgb`, `#rrggbb`, or falls back to `0, 0, 0` if we can't parse.
// Used so CSS can compose `rgba(var(--bg-primary-rgb), <alpha>)` without
// relying on color-mix support.
function hexToRgbTriplet(hex: string): string {
  let s = hex.trim().replace(/^#/, "");
  if (s.length === 3) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (s.length !== 6) return "0, 0, 0";
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return "0, 0, 0";
  return `${r}, ${g}, ${b}`;
}
