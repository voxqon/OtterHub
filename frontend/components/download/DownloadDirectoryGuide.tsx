"use client";
import { t, useLocale } from "@/lib/i18n";

import { FolderOpen, Save, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  pickDownloadDirectoryForFirstTime,
  type DirectoryHandleResult,
} from "@/lib/utils/file";

const FEATURES = [
  {
    Icon: FolderOpen,
    color: "text-blue-500",
    get title() {
      return t("推荐目录");
    },
    get desc() {
      return t("建议创建并选择 Downloads / OtterHub 目录");
    },
  },
  {
    Icon: Save,
    color: "text-purple-500",
    get title() {
      return t("记住选择");
    },
    get desc() {
      return t("大文件和批量下载时自动使用选择的目录");
    },
  },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDirectorySelected: (result: DirectoryHandleResult) => void;
}

export function DownloadDirectoryGuide({
  open,
  onOpenChange,
  onDirectorySelected,
}: Props) {
  useLocale();
  const handleSelect = () =>
    pickDownloadDirectoryForFirstTime().then(
      (r) => r && onDirectorySelected(r)
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            {t("选择下载目录")}
          </DialogTitle>
          <DialogDescription>
            {t("首次保存大文件或批量下载时，需要选择下载目录")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {FEATURES.map(({ Icon, color, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-lg border bg-muted/50 p-3"
            >
              <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${color}`} />
              <div>
                <p className="font-medium text-sm">{title}</p>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("取消")}
          </Button>
          <Button onClick={handleSelect}>{t("选择目录")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
