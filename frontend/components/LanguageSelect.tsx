"use client";

import { Languages } from "lucide-react";
import {
  LanguagePreference,
  setLanguagePreference,
  t,
  useLanguagePreference,
  useLocale,
} from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LanguageSelect() {
  useLocale();
  const preference = useLanguagePreference();
  return (
    <Select
      value={preference}
      onValueChange={(value) =>
        setLanguagePreference(value as LanguagePreference)
      }
    >
      <SelectTrigger className="w-40 shrink-0" aria-label={t("语言")}>
        <Languages className="mr-2 h-4 w-4 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{t("跟随浏览器")}</SelectItem>
        <SelectItem value="zh-CN">简体中文</SelectItem>
        <SelectItem value="en">English</SelectItem>
      </SelectContent>
    </Select>
  );
}
