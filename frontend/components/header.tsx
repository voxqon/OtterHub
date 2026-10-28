"use client";
import { t, useLocale } from "@/lib/i18n";

import { Search, X, Settings2 } from "lucide-react";
import { useFileQueryStore } from "@/stores/file";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState } from "react";
import { Button } from "./ui/button";
import { FileTypeDropdown } from "./FileTypeDropdown";
import { FileTypeTabs } from "./FileTypeTabs";
import { ImageLoadModeToggle } from "./ImageLoadModeToggle";
import { SafeModeToggle } from "./SafeModeToggle";
import { ThemeToggle } from "./ThemeToggle";
import { Input } from "./ui/input";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { APP_NAME } from "@/lib/ui-text";

export function Header() {
  useLocale();
  const { searchQuery, setSearchQuery } = useFileQueryStore();
  const isMobile = useIsMobile();
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  // 移动端头部导航栏
  if (isMobile) {
    return (
      <header className="sticky top-0 z-40 w-full border-b border-glass-border bg-glass-bg/80 backdrop-blur-xl">
        <div className="flex h-16 items-center px-4">
          {showMobileSearch ? (
            <div className="flex w-full items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40" />
                <Input
                  autoFocus
                  placeholder={t("搜索文件...")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-11 w-full pl-10 pr-10 bg-secondary/30 border-glass-border rounded-2xl focus-visible:ring-primary/40 placeholder:text-foreground/50 text-base"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 text-foreground/40 hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                )}
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowMobileSearch(false);
                  setSearchQuery("");
                }}
                className="text-base font-semibold text-primary"
              >
                {t("取消")}
              </Button>
            </div>
          ) : (
            <div className="flex w-full items-center justify-between animate-in fade-in duration-300">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-primary to-accent text-xl shadow-lg shadow-primary/20">
                  🦦
                </div>
                <span className="text-lg font-bold tracking-tight text-foreground">
                  {APP_NAME}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <FileTypeDropdown />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowMobileSearch(true)}
                  className="h-10 w-10 text-foreground/70 rounded-xl"
                >
                  <Search className="h-5 w-5" />
                </Button>
                <Sheet>
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-foreground/70 rounded-xl"
                    >
                      <Settings2 className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent
                    side="bottom"
                    className="rounded-t-[2.5rem] border-glass-border bg-popover/95 backdrop-blur-2xl pb-12 px-8"
                  >
                    <SheetHeader className="mb-2 pt-2">
                      <div className="mx-auto w-12 h-1.5 rounded-full bg-foreground/10 mb-6" />
                      <SheetTitle className="text-xl font-bold text-foreground flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <Settings2 className="h-5 w-5 text-primary" />
                        </div>
                        {t("偏好设置")}
                      </SheetTitle>
                    </SheetHeader>
                    <div className="space-y-8">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-foreground">
                            {t("安全模式")}
                          </p>
                          <p className="text-xs text-foreground/50">
                            {t("遮罩敏感内容 (NSFW)")}
                          </p>
                        </div>
                        <SafeModeToggle />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-foreground">
                            {t("图片加载")}
                          </p>
                          <p className="text-xs text-foreground/50">
                            {t("根据网络自动调整质量")}
                          </p>
                        </div>
                        <ImageLoadModeToggle />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-foreground">
                            {t("深色模式")}
                          </p>
                          <p className="text-xs text-foreground/50">
                            {t("随系统自动切换主题")}
                          </p>
                        </div>
                        <ThemeToggle />
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          )}
        </div>
      </header>
    );
  }

  // 桌面端头部导航栏
  return (
    <header className="sticky top-0 z-40 w-full border-b border-glass-border bg-glass-bg/85 backdrop-blur-2xl shadow-xs transition-all">
      <div className="max-w-7xl mx-auto flex h-18 items-center justify-between px-4 sm:px-6 md:px-8">
        {/* Left: Logo */}
        <div
          className="flex items-center gap-3.5 group cursor-pointer shrink-0 select-none"
          title={t("返回顶部")}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-linear-to-tr from-primary via-emerald-400 to-teal-300 text-2xl shadow-md shadow-primary/25 transition-all duration-300 group-hover:scale-105 group-hover:shadow-primary/40 group-active:scale-95">
            <span className="drop-shadow-xs">🦦</span>
          </div>
          <div className="hidden lg:flex flex-col">
            <h1 className="text-lg font-extrabold tracking-tight text-foreground leading-tight bg-linear-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text">
              {APP_NAME}
            </h1>
          </div>
        </div>

        {/* Center: Tabs */}
        <div className="flex-1 flex justify-center px-4">
          <FileTypeTabs />
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative group hidden lg:block">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40 group-focus-within:text-primary transition-colors" />
            <Input
              placeholder={t("搜索文件...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9.5 w-56 rounded-xl border-glass-border bg-secondary/35 pl-9.5 pr-9 text-sm focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:bg-secondary/60 placeholder:text-foreground/45 transition-all duration-200"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7.5 w-7.5 text-foreground/40 hover:text-foreground rounded-lg"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-secondary/25 p-1 border border-glass-border/70 backdrop-blur-md">
            <SafeModeToggle />
            <ImageLoadModeToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
