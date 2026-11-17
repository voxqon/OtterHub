"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, BookOpen, KeyRound } from "lucide-react";
import { LanguageSelect } from "@/components/LanguageSelect";
import { ThemeToggle } from "@/components/ThemeToggle";
import { t, useLocale } from "@/lib/i18n";

export function ApiPageShell({
  children,
  active,
}: {
  children: ReactNode;
  active: "docs" | "keys";
}) {
  useLocale();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2 text-sm">
            <ArrowLeft className="h-4 w-4" />
            OtterHub
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSelect />
            <ThemeToggle />
          </div>
          <nav aria-label="API" className="flex w-full gap-2 sm:w-auto">
            {(
              [
                {
                  id: "docs",
                  href: "/api-docs/",
                  label: t("API 调用说明"),
                  icon: BookOpen,
                },
                {
                  id: "keys",
                  href: "/api-keys/",
                  label: t("API 密钥管理"),
                  icon: KeyRound,
                },
              ] as const
            ).map((item) => (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active === item.id ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${active === item.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
