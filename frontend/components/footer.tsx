"use client";

import Link from "next/link";
import { Github } from "lucide-react";
import { t, useLocale } from "@/lib/i18n";

export function Footer() {
  useLocale();
  return (
    <footer className="flex flex-wrap items-center justify-center gap-5 py-4 text-sm text-foreground/60 transition-colors">
      <a
        href="https://github.com/voxqon/OtterHub.git"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2"
      >
        <Github className="h-5 w-5" />
        <span className="text-sm">OtterHub</span>
      </a>
      <Link href="/api-docs/" className="hover:text-primary">
        {t("API 调用说明")}
      </Link>
      <Link href="/api-keys/" className="hover:text-primary">
        {t("API 密钥管理")}
      </Link>
    </footer>
  );
}
