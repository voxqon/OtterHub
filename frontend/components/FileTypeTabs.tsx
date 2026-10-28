"use client";

import { ImageIcon, Music, Video, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

import { FileType } from "@shared/types";
import { useFileDataStore } from "@/stores/file";
import { t, useLocale } from "@/lib/i18n";

const fileTypes = [
  { id: FileType.Image, label: "图片", icon: ImageIcon },
  { id: FileType.Audio, label: "音频", icon: Music },
  { id: FileType.Video, label: "视频", icon: Video },
  { id: FileType.Document, label: "文档", icon: FileText },
];

export function FileTypeTabs() {
  useLocale();
  const activeType = useFileDataStore((s) => s.activeType);
  const setActiveType = useFileDataStore((s) => s.setActiveType);

  return (
    <div className="inline-flex items-center gap-1.5 p-1 rounded-2xl bg-secondary/30 border border-glass-border/70 backdrop-blur-md">
      {fileTypes.map((type) => {
        const Icon = type.icon;
        const isActive = activeType === type.id;

        return (
          <Button
            key={type.id}
            variant="ghost"
            size="sm"
            onClick={() => setActiveType(type.id)}
            className={`
              relative h-8 px-3.5 rounded-xl font-medium text-xs transition-all duration-200 select-none
              ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/90 hover:text-primary-foreground"
                  : "text-foreground/70 hover:text-foreground hover:bg-secondary/60"
              }
            `}
          >
            {Icon && (
              <Icon
                className={`h-3.5 w-3.5 mr-1.5 transition-transform duration-200 ${isActive ? "scale-110" : ""}`}
              />
            )}
            {t(type.label)}
          </Button>
        );
      })}
    </div>
  );
}
