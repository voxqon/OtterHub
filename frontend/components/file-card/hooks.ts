import { t, useLocale } from "@/lib/i18n";
import { useState, useMemo, useRef } from "react";
import {
  useActiveSelectedKeys,
  useFileDataStore,
  useFileUIStore,
} from "@/stores/file";
import {
  getFileTypeFromKey,
  downloadFile,
  getMissingChunkIndices,
  processBatch,
} from "@/lib/utils";
import {
  getFileDownloadUrl,
  getFileUrl,
  moveToTrash,
  toggleLike,
  uploadChunk,
  completeChunkUpload,
  getUploadChunkProgress,
} from "@/lib/api";
import { binaryExtensions, DIRECT_DOWNLOAD_LIMIT } from "@/lib/types";
import { toast } from "sonner";
import { shouldBlur } from "@/lib/utils";
import { FileItem, FileType, MAX_CHUNK_SIZE } from "@shared/types";
import { useGeneralSettingsStore } from "@/stores/general-store";
import { usePreviewStore } from "@/stores/preview-store";
import { isMobileBrowser } from "@/hooks/use-mobile";

/** 判断移动端大媒体文件是否应交给浏览器直接打开。 */
function shouldOpenLargeMediaOnMobile(fileType: FileType, fileSize: number) {
  return (
    isMobileBrowser() &&
    fileSize > DIRECT_DOWNLOAD_LIMIT &&
    (fileType === FileType.Audio || fileType === FileType.Video)
  );
}

/** 提供文件卡片的选择、查看、下载和编辑等操作。 */
export function useFileCardActions(file: FileItem) {
  useLocale();
  const { updateFileMetadata, moveToTrashLocal } = useFileDataStore();

  const { toggleSelection } = useFileUIStore();

  const { safeMode } = useGeneralSettingsStore();

  const { openPreview } = usePreviewStore();

  const selectedKeys = useActiveSelectedKeys();

  const [showDetail, setShowDetail] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isSelected = selectedKeys.includes(file.name);
  const fileType = useMemo(() => getFileTypeFromKey(file.name), [file.name]);
  const blur = shouldBlur({ safeMode, tags: file.metadata?.tags ?? [] });
  const isIncompleteUpload =
    file.metadata?.chunkInfo &&
    file.metadata.chunkInfo.uploadedIndices?.length !==
      file.metadata.chunkInfo.total;

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSelection(file.name, fileType);
  };

  const handleDelete = () => {
    if (!confirm(t("确定删除文件 {0} ?", file.metadata?.fileName))) return;
    moveToTrash(file.name)
      .then(() => {
        moveToTrashLocal(file);
        toast.success(t("已移入回收站"));
      })
      .catch(() => toast.error(t("移入回收站失败")));
  };

  const handleCopyLink = () => {
    const url = getFileUrl(file.name);
    navigator.clipboard.writeText(url);
    toast.success(t("文件链接复制成功~"));
  };

  const handleShare = () => {
    setShowShare(true);
  };

  const handleDownload = () => {
    const url = getFileDownloadUrl(file.name);
    const fileName = file.metadata?.fileName || file.name;
    const fileSize = file.metadata?.fileSize || 0;

    if (shouldOpenLargeMediaOnMobile(fileType, fileSize)) {
      toast.info(t("已打开文件链接，请使用浏览器下载"));
      window.open(getFileUrl(file.name), "_blank", "noopener,noreferrer");
      return;
    }

    const toastId =
      fileSize > DIRECT_DOWNLOAD_LIMIT
        ? toast.loading(t("准备下载: {0}", fileName))
        : null;

    void downloadFile(url, file.metadata, (progress) => {
      if (!toastId) return;
      const message = progress.dirName
        ? t(
            "下载到 {0}: {1} ({2}%)",
            progress.dirName,
            fileName,
            progress.percentage
          )
        : t("下载中: {0} ({1}%)", fileName, progress.percentage);
      toast.loading(message, { id: toastId });
    })
      .then((result) => {
        if (!toastId) return;
        if (result.status === "cancelled") {
          toast.dismiss(toastId);
          return;
        }
        const message = result.dirName
          ? t("下载完成: {0}，已保存到 {1}", fileName, result.dirName)
          : t("下载完成: {0}", fileName);
        toast.success(message, { id: toastId });
      })
      .catch(() => {
        if (toastId) {
          toast.error(t("下载失败: {0}", fileName), { id: toastId });
        } else {
          toast.error(t("下载失败"));
        }
      });
  };

  const handleView = () => {
    const url = getFileUrl(file.name);
    const fileName = file.metadata?.fileName?.toLowerCase() || "";
    const fileSize = file.metadata?.fileSize || 0;

    const canPreviewAsText =
      fileType === FileType.Document &&
      !binaryExtensions.some((ext) => fileName.endsWith(ext)) &&
      fileSize <= DIRECT_DOWNLOAD_LIMIT;

    if (fileType === FileType.Document) {
      if (!canPreviewAsText) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      openPreview(file, "text");
      return;
    }

    // 视频预览（预览器支持流式播放，不需要改变）
    if (fileType === FileType.Video) {
      openPreview(file, "video");
      return;
    }

    // 音频预览（预览器支持流式播放，不需要改变）
    if (fileType === FileType.Audio) {
      openPreview(file, "audio");
      return;
    }

    // 其他类型（图片、PDF、压缩包等）
    // 大文件直接触发下载
    if (fileSize > DIRECT_DOWNLOAD_LIMIT) {
      handleDownload();
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleEdit = () => {
    setShowEdit(true);
  };

  const handleEditSuccess = (updatedMetadata: any) => {
    updateFileMetadata(file.name, {
      ...file.metadata,
      ...updatedMetadata,
    });
  };

  const handleToggleLike = () => {
    toggleLike(file.name)
      .then(() => {
        updateFileMetadata(file.name, {
          ...file.metadata,
          liked: !file.metadata.liked,
        });
      })
      .catch(() => toast.error(t("收藏操作失败")));
  };

  const handleResumeUpload = () => {
    inputRef.current?.click();
  };

  const handleResumeFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile || !isIncompleteUpload) return;

    if (
      selectedFile.name !== file.metadata?.fileName ||
      selectedFile.size !== file.metadata?.fileSize
    ) {
      toast.error(t("文件不匹配"));
      return;
    }

    setIsResuming(true);
    try {
      const progress = await getUploadChunkProgress(file.name);
      const receipts = [...progress.receipts];
      const chunkIndicesToUpload = getMissingChunkIndices(
        progress.total,
        progress.uploadedIndices
      );

      await processBatch(
        chunkIndicesToUpload,
        async (chunkIndex) => {
          const start = chunkIndex * MAX_CHUNK_SIZE;
          const endPos = Math.min(start + MAX_CHUNK_SIZE, selectedFile.size);
          const chunkFile = selectedFile.slice(start, endPos);

          const result = await uploadChunk(file.name, chunkIndex, chunkFile);
          receipts.push(result.receipt);
        },
        undefined,
        2
      );

      const metadata = await completeChunkUpload(file.name, receipts);
      updateFileMetadata(file.name, metadata);
      toast.success(t("上传成功"));
    } catch (error) {
      console.error("继续上传失败:", error);
      toast.error(t("继续上传失败"));
    } finally {
      setIsResuming(false);
    }
  };

  return {
    // States
    isSelected,
    fileType,
    blur,
    isIncompleteUpload,
    showDetail,
    showEdit,
    showShare,
    isResuming,

    inputRef,

    // Actions
    setShowDetail,
    setShowEdit,
    setShowShare,
    handleSelect,
    handleDelete,
    handleCopyLink,
    handleShare,
    handleDownload,
    handleView,
    handleEdit,
    handleEditSuccess,
    handleToggleLike,
    handleResumeUpload,
    handleResumeFileSelect,
  };
}
