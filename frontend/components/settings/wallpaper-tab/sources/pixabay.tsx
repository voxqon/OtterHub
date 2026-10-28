"use client";

import { t, useLocale } from "@/lib/i18n";
import { WallpaperProvider, PixabayConfig } from "../types";
import { WallpaperSourceId } from "@shared/index";
import { ConfigInput, ConfigItem, ConfigSelect } from "./components";

const PIXABAY_CATEGORIES = [
  {
    value: "backgrounds",
    get label() {
      return t("背景");
    },
  },
  {
    value: "fashion",
    get label() {
      return t("时尚");
    },
  },
  {
    value: "nature",
    get label() {
      return t("自然");
    },
  },
  {
    value: "science",
    get label() {
      return t("科学");
    },
  },
  {
    value: "education",
    get label() {
      return t("教育");
    },
  },
  {
    value: "feelings",
    get label() {
      return t("情感");
    },
  },
  {
    value: "health",
    get label() {
      return t("健康");
    },
  },
  {
    value: "people",
    get label() {
      return t("人物");
    },
  },
  {
    value: "religion",
    get label() {
      return t("宗教");
    },
  },
  {
    value: "places",
    get label() {
      return t("地点");
    },
  },
  {
    value: "animals",
    get label() {
      return t("动物");
    },
  },
  {
    value: "industry",
    get label() {
      return t("工业");
    },
  },
  {
    value: "computer",
    get label() {
      return t("计算机");
    },
  },
  {
    value: "food",
    get label() {
      return t("美食");
    },
  },
  {
    value: "sports",
    get label() {
      return t("运动");
    },
  },
  {
    value: "transportation",
    get label() {
      return t("交通");
    },
  },
  {
    value: "travel",
    get label() {
      return t("旅行");
    },
  },
  {
    value: "buildings",
    get label() {
      return t("建筑");
    },
  },
  {
    value: "business",
    get label() {
      return t("商务");
    },
  },
  {
    value: "music",
    get label() {
      return t("音乐");
    },
  },
];

export const PixabaySource: WallpaperProvider<PixabayConfig> = {
  id: WallpaperSourceId.Pixabay,
  name: "Pixabay",
  requiresApiKey: true,
  defaultConfig: {
    apiKey: "", //  key
    q: "",
    category: "",
    order: "popular",
  },
  getApiKey: (config) => config.apiKey,
  setApiKey: (config, key) => ({ ...config, apiKey: key }),

  ConfigPanel: ({ config, onChange }) => {
    useLocale();
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ConfigItem label={t("关键词")}>
          <ConfigInput
            placeholder={t("搜索关键词...")}
            value={config.q}
            onChangeValue={(v) => onChange({ ...config, q: v })}
          />
        </ConfigItem>

        <ConfigItem label={t("分类")}>
          <ConfigSelect
            value={config.category || "all"}
            onValueChange={(v) =>
              onChange({ ...config, category: v === "all" ? "" : v })
            }
            options={[
              { value: "all", label: t("全部") },
              ...PIXABAY_CATEGORIES,
            ]}
            placeholder={t("全部")}
          />
        </ConfigItem>

        <ConfigItem label={t("排序")}>
          <ConfigSelect
            value={config.order || "popular"}
            onValueChange={(v: any) => onChange({ ...config, order: v })}
            options={[
              { value: "popular", label: t("热门") },
              { value: "latest", label: t("最新") },
            ]}
          />
        </ConfigItem>
      </div>
    );
  },
};
