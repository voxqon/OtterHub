"use client";

import { useEffect, useSyncExternalStore } from "react";
import { APP_DESC_CN, APP_DESC_EN, APP_NAME } from "@/lib/ui-text";
import {
  getLocale,
  getLanguagePreference,
  initializeLocale,
  LANGUAGE_STORAGE_KEY,
  refreshBrowserLocale,
  subscribeLocale,
  syncLanguagePreference,
} from "./core";

export * from "./core";

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, () => "en" as const);
}

export function useLanguagePreference() {
  return useSyncExternalStore(
    subscribeLocale,
    getLanguagePreference,
    () => "auto" as const
  );
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  useEffect(() => {
    const description = locale === "zh-CN" ? APP_DESC_CN : APP_DESC_EN;
    document.title = `${APP_NAME} - ${description}`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", description);
  }, [locale]);
  useEffect(() => {
    initializeLocale();
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null)
        syncLanguagePreference();
    };
    window.addEventListener("languagechange", refreshBrowserLocale);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("languagechange", refreshBrowserLocale);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return children;
}
