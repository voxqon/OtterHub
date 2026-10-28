"use client";

import { t, useLocale } from "@/lib/i18n";
import { UploadCloud, Sparkles } from "lucide-react";

export function EmptyState() {
  useLocale();
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="relative mb-6">
        <div className="w-28 h-28 rounded-3xl bg-linear-to-br from-primary/20 via-primary/10 to-transparent flex items-center justify-center text-6xl shadow-xl shadow-primary/10 border border-primary/20 backdrop-blur-xl animate-in zoom-in-50 duration-500">
          <span className="drop-shadow-sm select-none">🦦</span>
        </div>
        <div className="absolute -bottom-1 -right-1 p-2 rounded-xl bg-card border border-glass-border shadow-md">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
      </div>

      <h3 className="text-xl font-bold text-foreground mb-2 tracking-tight">
        {t("暂无任何文件")}
      </h3>
      <p className="text-foreground/60 max-w-sm mb-6 text-sm leading-relaxed">
        {t(
          "将文件拖放到上方的上传区域，或直接点击浏览，开启你的个人资源知识库。"
        )}
      </p>

      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-secondary/40 border border-glass-border text-xs text-foreground/70">
        <UploadCloud className="h-3.5 w-3.5 text-primary" />
        <span>{t("支持图片、音频、视频与各类文档")}</span>
      </div>
    </div>
  );
}
