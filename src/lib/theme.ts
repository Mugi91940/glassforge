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

  fontSans: string;
  fontMono: string;
  fontSizeBase: number;
  radiusMd: number;
};

export const DEFAULT_THEME: ThemeVars = {
  bgPrimary: "#0c0a1a",

  accentPrimary: "#818cf8",
  accentSecondary: "#34d399",
  accentGlowOpacity: 0.08,
  accentGlowRadius: 500,

  glassBlur: 40,
  glassSaturation: 1.6,
  glassBgOpacity: 0.04,

  windowBgOpacity: 0.95,
  kdeBlurEnabled: false,

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

  set("--accent-primary", vars.accentPrimary);
  set("--accent-secondary", vars.accentSecondary);
  set("--accent-glow-opacity", String(vars.accentGlowOpacity));
  set("--accent-glow-radius", `${vars.accentGlowRadius}px`);

  set("--glass-blur", `${vars.glassBlur}px`);
  set("--glass-saturation", String(vars.glassSaturation));
  set("--glass-bg", `rgba(255, 255, 255, ${vars.glassBgOpacity})`);

  set("--window-bg-opacity", String(vars.windowBgOpacity));

  set("--font-sans", vars.fontSans);
  set("--font-mono", vars.fontMono);
  set("--font-size-base", `${vars.fontSizeBase}px`);

  set("--radius-md", `${vars.radiusMd}px`);
  set("--radius-sm", `${Math.max(4, vars.radiusMd - 4)}px`);
  set("--radius-lg", `${vars.radiusMd + 4}px`);
}
