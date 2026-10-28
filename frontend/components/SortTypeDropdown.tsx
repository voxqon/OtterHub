"use client";
import { t, useLocale } from "@/lib/i18n";

import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ClockArrowDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useFileQueryStore } from "@/stores/file";
import { SortType, SortOrder } from "@/lib/types";

const typeOptions = [
  {
    value: SortType.UploadedAt,
    get label() {
      return t("上传时间");
    },
    icon: ClockArrowDown,
  },
  {
    value: SortType.Name,
    get label() {
      return t("文件名称");
    },
    icon: ArrowDownAZ,
  },
  {
    value: SortType.FileSize,
    get label() {
      return t("文件大小");
    },
    icon: ArrowDownWideNarrow,
  },
];

export function SortTypeDropdown() {
  useLocale();
  const { sortType, sortOrder, setSortType, setSortOrder } =
    useFileQueryStore();

  const currentType = typeOptions.find((o) => o.value === sortType);
  const OrderIcon = sortOrder === SortOrder.Asc ? ArrowUp : ArrowDown;
  const TypeIcon = currentType?.icon;

  const toggleOrder = () => {
    setSortOrder(sortOrder === SortOrder.Asc ? SortOrder.Desc : SortOrder.Asc);
  };

  return (
    <div className="flex items-center rounded-xl bg-secondary/30 border border-glass-border/70 backdrop-blur-md overflow-hidden p-0.5">
      {/* 切换排序顺序的按钮 */}
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleOrder}
        className="h-7.5 px-2.5 text-foreground/80 hover:text-foreground hover:bg-secondary/60 gap-1.5 rounded-lg border-none focus-visible:ring-0 text-xs font-medium"
      >
        {TypeIcon && <TypeIcon className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{currentType?.label}</span>
        <OrderIcon className="h-3.5 w-3.5 text-foreground/50" />
      </Button>

      {/* 分隔线 */}
      <div className="w-px h-3.5 bg-glass-border/70 mx-0.5" />

      {/* 切换排序类型的下拉菜单 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7.5 px-1.5 text-foreground/50 hover:text-foreground hover:bg-secondary/60 rounded-lg border-none focus-visible:ring-0"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-40 bg-popover/95 backdrop-blur-xl border-glass-border shadow-xl rounded-xl"
        >
          <DropdownMenuLabel className="text-xs text-foreground/50">
            {t("排序字段")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sortType}
            onValueChange={(v) => setSortType(v as SortType)}
          >
            {typeOptions.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  className="text-foreground focus:text-foreground cursor-pointer rounded-lg text-xs"
                >
                  <Icon className="h-3.5 w-3.5 mr-2 text-foreground/60" />
                  {option.label}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
