import { Check, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileTagBadge } from "@/components/FileTagBadge";
import { FileDetailDialog } from "@/components/file-card/FileDetailDialog";
import { FileActions } from "./FileActions";
import { FileContent, ICON_DISPLAY_SIZE } from "./FileContent";
import { FileItem } from "@shared/types";
import { cn, formatFileSize, formatDate } from "@/lib/utils";
import { useFileCardActions } from "./hooks";
import { NsfwSign } from "./NsfwSign";
import { FileEditDialog } from "./FileEditDialog";
import { ShareDialog } from "../file/share-dialog";
import { useGeneralSettingsStore } from "@/stores/general-store";


interface FileCardGridProps {
  file: FileItem;
  actions: ReturnType<typeof useFileCardActions>;
}

export function FileCardGrid({ file, actions }: FileCardGridProps) {
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

  const { safeMode, imageLoadMode } = useGeneralSettingsStore();
  const tags = file.metadata?.tags ?? [];

  return (
    <>
      <div
        className={cn(
          "group relative aspect-square rounded-2xl overflow-hidden backdrop-blur-xl border transition-all duration-300 cursor-pointer shadow-xs hover:shadow-xl hover:shadow-black/10",
          isSelected
            ? "bg-primary/20 border-primary ring-2 ring-primary/40 shadow-primary/20"
            : "bg-card/40 border-glass-border hover:border-primary/40 hover:-translate-y-0.5",
        )}
      >
        {/* Checkbox */}
        <div className="absolute top-3 left-3 z-10">
          <div
            className={cn(
              "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 backdrop-blur-md",
              isSelected
                ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                : "bg-black/30 border-white/40 hover:border-white opacity-100 md:opacity-0 md:group-hover:opacity-100",
            )}
            onClick={handleSelect}
          >
            {isSelected && <Check className="h-3.5 w-3.5" />}
          </div>
        </div>

        {/* Actions Menu */}
        <div className="absolute top-3 right-3 z-10 transition-opacity duration-200 opacity-90 md:opacity-0 md:group-hover:opacity-100">
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

        {/* File Content */}
        <div className="absolute inset-0 flex items-center justify-center transition-transform duration-500 group-hover:scale-[1.03]">
          <div className="relative w-full h-full bg-linear-to-br from-teal-500/10 via-primary/5 to-cyan-500/10 flex items-center justify-center">
            <FileContent
              fileType={fileType}
              fileKey={file.name}
              safeMode={safeMode}
              canPreview={!blur}
              tags={tags}
              fileSize={file.metadata?.fileSize ?? 0}
              imageLoadMode={imageLoadMode}
              thumbUrl={file.metadata?.thumbUrl || ""}
              className={ICON_DISPLAY_SIZE}
            />
            {blur && <NsfwSign />}
          </div>
        </div>

        {/* File Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-3.5 bg-linear-to-t from-black/85 via-black/55 to-transparent backdrop-blur-[2px]">
          <div className="flex items-center gap-2 mb-1">
            <p className={cn("text-xs sm:text-sm font-semibold text-white truncate transition-all duration-300 drop-shadow-xs", blur && "blur-xs select-none opacity-80")} title={file.metadata?.fileName}>
              {file.metadata?.fileName || file.name}
            </p>
            <div className="flex gap-1 shrink-0">
              {tags.map((tag) => (
                <FileTagBadge key={tag} tag={tag} forceDark />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] text-white/70 min-w-0 font-medium">
              <span className="shrink-0">{formatFileSize(file.metadata?.fileSize || 0)}</span>
              <span>•</span>
              <span className="shrink-0 truncate">{formatDate(file.metadata?.uploadedAt || 0)}</span>
            </p>
            {isIncompleteUpload && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResumeUpload();
                }}
                disabled={isResuming}
                className="text-amber-300 hover:bg-amber-500/20 h-5 px-1.5 text-[11px] rounded-md"
              >
                {isResuming ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <RotateCw className="h-3 w-3 mr-1" />
                    {file.metadata.chunkInfo!.uploadedIndices.length}/
                    {file.metadata.chunkInfo!.total}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
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
