"use client";

import { t, useLocale } from "@/lib/i18n";
import { WallpaperProvider, UnsplashConfig } from "../types";
import { WallpaperSourceId } from "@shared/types";
import { ConfigInput, ConfigItem, ConfigSelect } from "./components";

export const UnsplashSource: WallpaperProvider<UnsplashConfig> = {
  id: WallpaperSourceId.Unsplash,
  name: "Unsplash",
  requiresApiKey: true,
  defaultConfig: {
    apiKey: "", //  Access Key
    query: "",
    orientation: "landscape",
    content_filter: "low",
  },
  getApiKey: (config) => config.apiKey,
  setApiKey: (config, accessKey) => ({ ...config, apiKey: accessKey }),

  ConfigPanel: ({ config, onChange }) => {
    useLocale();
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ConfigItem label={t("搜索关键词")}>
          <ConfigInput
            placeholder={t("例如: Nature, Architecture...")}
            value={config.query}
            onChangeValue={(v) => onChange({ ...config, query: v })}
          />
        </ConfigItem>

        <ConfigItem label={t("画幅方向")}>
          <ConfigSelect
            value={config.orientation || "landscape"}
            onValueChange={(v: any) => onChange({ ...config, orientation: v })}
            options={[
              { value: "landscape", label: t("横屏 (Landscape)") },
              { value: "portrait", label: t("竖屏 (Portrait)") },
              { value: "squarish", label: t("正方形 (Squarish)") },
            ]}
          />
        </ConfigItem>

        <ConfigItem label={t("内容过滤")}>
          <ConfigSelect
            value={config.content_filter || "low"}
            onValueChange={(v: any) =>
              onChange({ ...config, content_filter: v })
            }
            options={[
              { value: "low", label: t("常规 (Low)") },
              { value: "high", label: t("严格 (High)") },
            ]}
          />
        </ConfigItem>
      </div>
    );
  },
};
