import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { StyleSheet, type ViewStyle, type TextStyle, type ImageStyle } from "react-native";

export const fonts = {
  display: "Georgia",
  body: "System",
};

export type ColorTokens = {
  bg: string;
  bgDeep: string;
  ink: string;
  inkSoft: string;
  brand: string;
  brandSoft: string;
  accent: string;
  card: string;
  line: string;
  bubbleMine: string;
  bubbleTheirs: string;
  bubbleAgent: string;
  danger: string;
  onBrand: string;
  inputBg: string;
  brandWash: string;
  isDark: boolean;
};

export type ThemeId = "forest" | "honey" | "clay" | "mist" | "night";

export type ThemeDef = {
  id: ThemeId;
  label: string;
  hint: string;
  colors: ColorTokens;
};

const STORAGE_KEY = "forever.theme.v1";

export const THEMES: ThemeDef[] = [
  {
    id: "forest",
    label: "Rừng",
    hint: "Xanh mái nhà — mặc định",
    colors: {
      bg: "#f4efe6",
      bgDeep: "#e8dfd0",
      ink: "#1c241f",
      inkSoft: "#4a564f",
      brand: "#2d4a3e",
      brandSoft: "#3f6353",
      accent: "#c4a574",
      card: "#fffaf2",
      line: "rgba(28, 36, 31, 0.12)",
      bubbleMine: "#2d4a3e",
      bubbleTheirs: "#ffffff",
      bubbleAgent: "#eef4f0",
      danger: "#8b3a3a",
      onBrand: "#f4efe6",
      inputBg: "#ffffff",
      brandWash: "rgba(45, 74, 62, 0.08)",
      isDark: false,
    },
  },
  {
    id: "honey",
    label: "Mật ong",
    hint: "Ấm, giấy cũ, trà chiều",
    colors: {
      bg: "#fbf6ea",
      bgDeep: "#f0e4c8",
      ink: "#3a2a16",
      inkSoft: "#7a6240",
      brand: "#b06b1f",
      brandSoft: "#c48438",
      accent: "#d4a017",
      card: "#fffdf7",
      line: "rgba(58, 42, 22, 0.12)",
      bubbleMine: "#b06b1f",
      bubbleTheirs: "#ffffff",
      bubbleAgent: "#f7edd6",
      danger: "#9b3d2a",
      onBrand: "#fff8ee",
      inputBg: "#ffffff",
      brandWash: "rgba(176, 107, 31, 0.12)",
      isDark: false,
    },
  },
  {
    id: "clay",
    label: "Đất nung",
    hint: "Gạch Bát Tràng, gốm ấm",
    colors: {
      bg: "#f7efe8",
      bgDeep: "#ead9cc",
      ink: "#2c1c16",
      inkSoft: "#6b4e43",
      brand: "#9a3f2d",
      brandSoft: "#b55a45",
      accent: "#d4a574",
      card: "#fff8f3",
      line: "rgba(44, 28, 22, 0.12)",
      bubbleMine: "#9a3f2d",
      bubbleTheirs: "#ffffff",
      bubbleAgent: "#f3e6dc",
      danger: "#8b2e2e",
      onBrand: "#f7efe8",
      inputBg: "#ffffff",
      brandWash: "rgba(154, 63, 45, 0.10)",
      isDark: false,
    },
  },
  {
    id: "mist",
    label: "Sương",
    hint: "Xám xanh, dịu mắt",
    colors: {
      bg: "#eef1f4",
      bgDeep: "#dce3ea",
      ink: "#1c242c",
      inkSoft: "#5a6570",
      brand: "#3d5a73",
      brandSoft: "#52748f",
      accent: "#8aa3b5",
      card: "#f7f9fb",
      line: "rgba(28, 36, 44, 0.12)",
      bubbleMine: "#3d5a73",
      bubbleTheirs: "#ffffff",
      bubbleAgent: "#e4ecf2",
      danger: "#8b3a3a",
      onBrand: "#eef1f4",
      inputBg: "#ffffff",
      brandWash: "rgba(61, 90, 115, 0.10)",
      isDark: false,
    },
  },
  {
    id: "night",
    label: "Đêm",
    hint: "Tối, đọc ký ức ban đêm",
    colors: {
      bg: "#161a18",
      bgDeep: "#0f1211",
      ink: "#e8e4d8",
      inkSoft: "#9aa39c",
      brand: "#c4a574",
      brandSoft: "#d4b98a",
      accent: "#c4a574",
      card: "#1e2421",
      line: "rgba(232, 228, 216, 0.12)",
      bubbleMine: "#2d4a3e",
      bubbleTheirs: "#252b28",
      bubbleAgent: "#24302b",
      danger: "#d47474",
      onBrand: "#1c241f",
      inputBg: "#252b28",
      brandWash: "rgba(196, 165, 116, 0.16)",
      isDark: true,
    },
  },
];

export const DEFAULT_THEME_ID: ThemeId = "forest";

const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<
  ThemeId,
  ThemeDef
>;

function isThemeId(value: string | null): value is ThemeId {
  return value != null && value in THEME_BY_ID;
}

/** Live palette — mutated when the user picks a theme so inline `colors.x` stays current. */
export const colors: ColorTokens = { ...THEME_BY_ID[DEFAULT_THEME_ID].colors };

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

type SheetEntry = {
  factory: (c: ColorTokens) => NamedStyles;
  holder: { current: NamedStyles };
};

const sheetRegistry: SheetEntry[] = [];

function applyPalette(next: ColorTokens) {
  Object.assign(colors, next);
  for (const entry of sheetRegistry) {
    entry.holder.current = StyleSheet.create(entry.factory(colors));
  }
}

/**
 * Module-level styles that track the active palette. Pair with `useTheme()`
 * (or `useSpaceScreenOptions`) so the screen re-renders after a change.
 */
export function createThemedStyles<T extends NamedStyles>(
  factory: (c: ColorTokens) => T,
): T {
  const holder = { current: StyleSheet.create(factory(colors)) as T };
  sheetRegistry.push({
    factory: factory as (c: ColorTokens) => NamedStyles,
    holder: holder as { current: NamedStyles },
  });
  return new Proxy({} as T, {
    get(_target, prop: string) {
      return holder.current[prop];
    },
  });
}

type ThemeContextValue = {
  themeId: ThemeId;
  colors: ColorTokens;
  themes: ThemeDef[];
  setThemeId: (id: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (cancelled || !isThemeId(raw) || raw === DEFAULT_THEME_ID) return;
      applyPalette(THEME_BY_ID[raw].colors);
      setThemeIdState(raw);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setThemeId = useCallback((id: ThemeId) => {
    applyPalette(THEME_BY_ID[id].colors);
    setThemeIdState(id);
    void AsyncStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      colors: THEME_BY_ID[themeId].colors,
      themes: THEMES,
      setThemeId,
    }),
    [themeId, setThemeId],
  );

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return ctx;
}
