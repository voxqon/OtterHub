import { english } from "./messages";

export type Locale = "zh-CN" | "en";
export type LanguagePreference = "auto" | Locale;
export const LANGUAGE_STORAGE_KEY = "otterhub-language";
let preference: LanguagePreference = "auto";
let locale: Locale = "en";
let initialized = false;
const listeners = new Set<() => void>();

export function resolveLocale(
  value: LanguagePreference,
  languages: readonly string[]
): Locale {
  if (value !== "auto") return value;
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh-CN";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "en";
}

export function parseLanguagePreference(
  value: string | null
): LanguagePreference {
  return value === "zh-CN" || value === "en" ? value : "auto";
}

export const getLocale = () => locale;
export const getLanguagePreference = () => preference;
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function updateLocale() {
  locale = resolveLocale(
    preference,
    navigator.languages?.length ? navigator.languages : [navigator.language]
  );
  document.documentElement.lang = locale;
  listeners.forEach((listener) => listener());
}

export function initializeLocale() {
  if (initialized) return;
  initialized = true;
  try {
    preference = parseLanguagePreference(
      localStorage.getItem(LANGUAGE_STORAGE_KEY)
    );
  } catch {
    preference = "auto";
  }
  updateLocale();
}

export function setLanguagePreference(value: LanguagePreference) {
  preference = value;
  try {
    if (value === "auto") localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    // Language changes still work when browser storage is unavailable.
  }
  updateLocale();
}

export function refreshBrowserLocale() {
  if (preference === "auto") updateLocale();
}

export function syncLanguagePreference() {
  try {
    preference = parseLanguagePreference(
      localStorage.getItem(LANGUAGE_STORAGE_KEY)
    );
    updateLocale();
  } catch {
    // Keep the current selection when storage cannot be read.
  }
}

export function translate(
  language: Locale,
  message: string,
  ...values: (string | number | null | undefined)[]
) {
  const template = language === "en" ? (english[message] ?? message) : message;
  return template.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? "") : match
  );
}

export function t(
  message: string,
  ...values: (string | number | null | undefined)[]
) {
  return translate(locale, message, ...values);
}
