"use client";
import { t, useLocale } from "@/lib/i18n";

import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  completeChunkUpload,
  uploadChunkInit,
  uploadChunkWithProgress,
  uploadFileWithProgress,
} from "@/lib/api";
import {
  buildTmpFileKey,
  formatFileSize,
  getFileType,
  cn,
  processBatch,
  getMissingChunkIndices,
  scanFiles,
} from "@/lib/utils";
import { useFileDataStore } from "@/stores/file";
import { nsfwDetector } from "@/lib/nsfw-detector";
import { toast } from "sonner";
import {
  FileItem,
  FileTag,
  MAX_CHUNK_SIZE,
  MAX_FILENAME_LENGTH,
  MAX_FILE_SIZE,
} from "@shared/types";
import { useGeneralSettingsStore } from "@/stores/general-store";
import { MAX_CONCURRENTS } from "@/lib/types";

export function FileUploadZone() {
  useLocale();
  const addFileLocal = useFileDataStore((s) => s.addFileLocal);
  const { nsfwDetection, defaultUploadTags } = useGeneralSettingsStore();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>(
    {}
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.isArray(files) ? files : Array.from(files);
      if (!fileArray.length) return;

      // 重命名文件名过长的文件 (保留扩展名)
      const processedFiles = fileArray.map((file) => {
        if (file.name.length <= MAX_FILENAME_LENGTH) return file;

        const extIndex = file.name.lastIndexOf(".");
        const ext = extIndex !== -1 ? file.name.substring(extIndex) : "";
        const nameWithoutExt =
          extIndex !== -1 ? file.name.substring(0, extIndex) : file.name;

        // 截断文件名，预留扩展名空间
        const truncatedName = nameWithoutExt.substring(
          0,
          MAX_FILENAME_LENGTH - ext.length
        );
        const newName = truncatedName + ext;

        // 创建新文件对象
        return new File([file], newName, {
          type: file.type,
          lastModified: file.lastModified,
        });
      });

      const uploadProgressMap: Record<string, number> = {};
      setUploadProgress({});

      let successCount = 0;
      const failed: string[] = [];

      /** 普通上传 */
      const uploadNormalFile = async (file: File) => {
        const tmpKey = buildTmpFileKey(file);
        uploadProgressMap[tmpKey] = 0;
        setUploadProgress({ ...uploadProgressMap });

        try {
          const isUnsafe = nsfwDetection
            ? await nsfwDetector.isUnsafeImg(file)
            : false;
          const key = await uploadFileWithProgress(
            file,
            { nsfw: isUnsafe, tags: defaultUploadTags },
            (p) => {
              uploadProgressMap[tmpKey] = p.percent;
              setUploadProgress({ ...uploadProgressMap });
            }
          );

          uploadProgressMap[tmpKey] = 100;
          setUploadProgress({ ...uploadProgressMap });

          const fileItem: FileItem = {
            name: key,
            metadata: {
              fileName: file.name,
              fileSize: file.size,
              uploadedAt: Date.now(),
              liked: false,
              tags: Array.from(
                new Set([
                  ...defaultUploadTags,
                  ...(isUnsafe ? [FileTag.NSFW] : []),
                ])
              ),
            },
          };

          addFileLocal(fileItem, getFileType(file.type, file.name));
          successCount++;
        } catch (err) {
          failed.push(`${file.name}: ${(err as Error).message}`);
        } finally {
          setTimeout(() => {
            delete uploadProgressMap[tmpKey];
            setUploadProgress({ ...uploadProgressMap });
          }, 400);
        }
      };

      /** 分片上传 */
      const uploadChunkedFile = async (file: File) => {
        if (file.size > MAX_FILE_SIZE) {
          toast.warning(t("文件大小超过 {0}", formatFileSize(MAX_FILE_SIZE)));
          return;
        }

        const tmpKey = buildTmpFileKey(file);
        uploadProgressMap[tmpKey] = 0;
        setUploadProgress({ ...uploadProgressMap });

        try {
          const fileType = getFileType(file.type, file.name);
          const totalChunks = Math.ceil(file.size / MAX_CHUNK_SIZE);

          const key = await uploadChunkInit({
            fileType,
            fileName: file.name,
            fileSize: file.size,
            totalChunks,
            tags: defaultUploadTags,
          });
          addFileLocal(
            {
              name: key,
              metadata: {
                fileName: file.name,
                fileSize: file.size,
                uploadedAt: Date.now(),
                liked: false,
                tags: defaultUploadTags,
                chunkInfo: { total: totalChunks, uploadedIndices: [] },
              },
            },
            fileType
          );

          const missing = getMissingChunkIndices(totalChunks);
          const uploadedBytesByChunk = new Map<number, number>();
          const receipts: string[] = [];
          let uploadedBytesTotal = 0;

          const uploadOne = async (idx: number) => {
            const start = idx * MAX_CHUNK_SIZE;
            const end = Math.min(start + MAX_CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);
            const chunkSize = end - start;

            const result = await uploadChunkWithProgress(
              key,
              idx,
              chunk,
              (p) => {
                const loaded = Math.min(p.loaded, chunkSize);
                const prev = uploadedBytesByChunk.get(idx) || 0;
                if (loaded === prev) return;

                uploadedBytesByChunk.set(idx, loaded);
                uploadedBytesTotal += loaded - prev;

                uploadProgressMap[tmpKey] = Math.min(
                  99,
                  Math.round((uploadedBytesTotal / file.size) * 100)
                );
                setUploadProgress({ ...uploadProgressMap });
              }
            );
            receipts.push(result.receipt);

            const prev = uploadedBytesByChunk.get(idx) || 0;
            if (prev < chunkSize) {
              uploadedBytesByChunk.set(idx, chunkSize);
              uploadedBytesTotal += chunkSize - prev;
            }

            uploadProgressMap[tmpKey] = Math.min(
              99,
              Math.round((uploadedBytesTotal / file.size) * 100)
            );
            setUploadProgress({ ...uploadProgressMap });
          };

          // Limit nested concurrency when several large files are uploaded together.
          await processBatch(missing, uploadOne, undefined, 2);
          const metadata = await completeChunkUpload(key, receipts);
          uploadProgressMap[tmpKey] = 100;
          setUploadProgress({ ...uploadProgressMap });

          const fileItem: FileItem = {
            name: key,
            metadata,
          };

          addFileLocal(fileItem, fileType);
          successCount++;
        } catch (err) {
          failed.push(`${file.name}: ${(err as Error).message}`);
        } finally {
          setTimeout(() => {
            delete uploadProgressMap[tmpKey];
            setUploadProgress({ ...uploadProgressMap });
          }, 400);
        }
      };

      /** 并发上传 */
      await processBatch(
        processedFiles,
        (file) =>
          file.size > MAX_CHUNK_SIZE
            ? uploadChunkedFile(file)
            : uploadNormalFile(file),
        undefined,
        MAX_CONCURRENTS
      );

      if (successCount > 0) {
        toast.success(t("成功上传 {0} 个文件", successCount));
      }

      if (failed.length) {
        toast.error(t("{0}个文件上传失败", failed.length), {
          description: failed.join(", "),
        });
      }
    },
    [addFileLocal, nsfwDetection, defaultUploadTags]
  );

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.isArray(files) ? files : Array.from(files);
    if (!fileArray.length) return;

    processFiles(fileArray);
  };

  return (
    <div className="mb-8">
      <div
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragging(false);

          if (e.dataTransfer.items) {
            const files = await scanFiles(e.dataTransfer.items);
            handleFiles(files);
          } else {
            handleFiles(e.dataTransfer.files);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "relative border border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-300 backdrop-blur-xl group overflow-hidden shadow-xs",
          isDragging
            ? "border-primary bg-primary/10 shadow-lg shadow-primary/10 scale-[1.008]"
            : "border-glass-border bg-glass-bg/60 hover:bg-glass-bg/90 hover:border-primary/40 hover:shadow-md hover:shadow-black/5"
        )}
      >
        <div className="absolute inset-0 bg-linear-to-b from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center justify-center">
          <div
            className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center mb-3 transition-all duration-300 shadow-xs",
              isDragging
                ? "bg-primary text-primary-foreground scale-110 rotate-3 shadow-primary/30"
                : "bg-secondary/60 text-foreground/60 group-hover:bg-primary/15 group-hover:text-primary group-hover:scale-105"
            )}
          >
            <Upload className="h-5 w-5 transition-transform" />
          </div>

          <p
            className={cn(
              "text-sm font-medium transition-colors mb-1",
              isDragging
                ? "text-primary"
                : "text-foreground/80 group-hover:text-foreground"
            )}
          >
            {isDragging
              ? t("松开鼠标即可极速上传")
              : t("拖拽文件到此处，或点击浏览本地文件")}
          </p>

          <p className="text-xs text-foreground/45 transition-colors">
            {t("支持图片、音频、视频及文档，多文件与大文件自动分片上传")}
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {Object.keys(uploadProgress).length > 0 && (
        <div className="mt-4 space-y-2.5">
          {Object.entries(uploadProgress).map(([k, v]) => (
            <div
              key={k}
              className="bg-card/70 backdrop-blur-lg p-3 rounded-xl border border-glass-border shadow-xs animate-in fade-in slide-in-from-top-1 duration-200"
            >
              <div className="flex justify-between items-center text-xs mb-1.5 text-foreground/80 font-medium">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-primary animate-ping" />
                  {t("上传中...")}
                </span>
                <span className="font-mono text-primary font-semibold">
                  {v}%
                </span>
              </div>
              <Progress
                value={v}
                className="h-1.5 bg-secondary/60 rounded-full"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
