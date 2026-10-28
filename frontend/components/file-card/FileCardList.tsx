import { Loader2, RotateCw, Music, Video, FileText, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileTagBadge } from "@/components/FileTagBadge";
import { FileDetailDialog } from "@/components/file-card/FileDetailDialog";
import { FileActions } from "./FileActions";
import { FileItem, FileType } from "@shared/types";
import { cn, formatFileSize, formatTime } from "@/lib/utils";
import { useFileCardActions } from "./hooks";
import { FileEditDialog } from "./FileEditDialog";
import { ShareDialog } from "../file/share-dialog";

interface FileCardListProps {
  file: FileItem;
  actions: ReturnType<typeof useFileCardActions>;
}

export function FileCardList({ file, actions }: FileCardListProps) {
  const {
    isSelected,
    fileType,
    blur,
    isIncompleteUpload,
    showDetail,
    showEdit,
    isResuming,
    setShowDetail,
    setShowEdit,
    handleSelect,
    handleDelete,
    handleCopyLink,
    handleDownload,
    handleView,
    handleEdit,
    handleEditSuccess,
    handleToggleLike,
    handleResumeUpload,
  } = actions;

  const tags = file.metadata?.tags ?? [];
  
  // 根据文件类型获取对应的图标
  const getFileIcon = () => {
    switch (fileType) {
      case FileType.Audio: return <Music className="h-4 w-4 text-emerald-400" />;
      case FileType.Video: return <Video className="h-4 w-4 text-purple-400" />;
      case FileType.Image: return <ImageIcon className="h-4 w-4 text-blue-400" />;
      default: return <FileText className="h-4 w-4 text-amber-400" />;
    }
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-4 px-4 py-3 rounded-xl backdrop-blur-xl border transition-all duration-200 cursor-pointer shadow-xs",
          isSelected
            ? "bg-primary/20 border-primary shadow-sm shadow-primary/10"
            : "bg-card/40 border-glass-border hover:border-primary/40 hover:bg-card/70 hover:shadow-sm",
        )}
        onClick={handleSelect}
      >
        {/* File Icon */}
        <div className="flex items-center justify-center shrink-0 w-9 h-9 rounded-lg bg-secondary/50 border border-glass-border/60 group-hover:scale-105 transition-transform">
          {getFileIcon()}
        </div>

        {/* File Info */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p className={cn("text-sm font-semibold truncate leading-tight transition-all duration-300 text-foreground", blur && "blur-xs select-none opacity-80")} title={file.metadata?.fileName}>
            {file.metadata?.fileName}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-foreground/50 leading-none">
            <span className="shrink-0 font-medium">{formatFileSize(file.metadata?.fileSize || 0)}</span>
            <span className="text-foreground/30">•</span>
            <span className="shrink-0 truncate">{formatTime(file.metadata?.uploadedAt || 0)}</span>
            {tags.length > 0 && (
              <>
                <span className="text-foreground/30">•</span>
                <div className="flex gap-1 overflow-hidden">
                  {tags.map((tag) => (
                    <FileTagBadge key={tag} tag={tag} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 继续上传按钮 */}
        {isIncompleteUpload && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleResumeUpload();
            }}
            disabled={isResuming}
            title="继续上传"
            className="h-7 text-amber-300 border-amber-500/80 hover:bg-amber-500/50 shrink-0 px-2 rounded-lg text-xs"
          >
            {isResuming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 text-xs hidden sm:inline">
              {file.metadata.chunkInfo!.uploadedIndices?.length || 0}/
              {file.metadata.chunkInfo!.total}
            </span>
          </Button>
        )}

        {/* Actions */}
        <FileActions
          onDownload={handleDownload}
          onDelete={handleDelete}
          onView={handleView}
          onEdit={handleEdit}
          onToggleLike={handleToggleLike}
          onCopyLink={handleCopyLink}
          onShowDetail={() => setShowDetail(true)}
          onShare={actions.handleShare}
          isLiked={file.metadata?.liked || false}
        />
      </div>

      <FileDetailDialog
        file={file}
        open={showDetail}
        onOpenChange={setShowDetail}
      />
      <FileEditDialog
        file={file}
        open={showEdit}
        onOpenChange={setShowEdit}
        onSuccess={handleEditSuccess}
      />
      <ShareDialog
        open={actions.showShare}
        onOpenChange={actions.setShowShare}
        fileKey={file.name}
        fileName={file.metadata?.fileName}
      />
    </>
  );
}
