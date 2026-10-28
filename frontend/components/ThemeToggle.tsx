"use client";
import { t, useLocale } from "@/lib/i18n";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeToggle() {
  useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    clientSnapshot,
    serverSnapshot
  );

  const isHydrated = hydrated && resolvedTheme !== undefined;
  const isDark = resolvedTheme === "dark";

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (!isHydrated) return;
              setTheme(isDark ? "light" : "dark");
            }}
            className="h-9 w-9 text-foreground/60 hover:text-foreground hover:bg-secondary/50"
            disabled={!isHydrated}
            aria-label={t("切换主题")}
          >
            {!isHydrated ? null : isDark ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {!isHydrated
              ? t("切换主题")
              : isDark
                ? t("深色模式")
                : t("浅色模式")}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
