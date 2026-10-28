import { BaseAdapter } from "./base-adapter";
import type { FileRecord } from ".";
import { createChunkStream } from "./chunk-stream";
import { failResponse } from "@utils/response";
import { encodeContentDisposition } from "../common";
import { buildKeyId, getFileIdFromKey, getContentTypeByExt } from "../file";

import {
  FileMetadata,
  ApiResponse,
  Chunk,
  FileType,
  GeneralSettings,
} from "@shared/types";
import {
  parseRangeHeader,
  sortChunksAndCalculateSize,
  validateChunksForMerge,
} from "./shared-utils";
import {
  getTgFileId,
  getTgImageVariantIds,
  getTgFileSize,
  getVideoThumbId,
  resolveFileDescriptor,
  buildTgApiUrl,
  buildTgFileUrl,
  getTgFilePath,
  processGifFile,
} from "./tg-tools";

import { MAX_CHUNK_SIZE } from "@shared/types";
import { analyzeImageAndEnrich, isSupportedImage } from "../ai/image-analysis";
import { kvGetJSON } from "@utils/kv";
import { CF } from "types";

// Telegram存储适配器实现
export class TGAdapter extends BaseAdapter {
  constructor(env: any, kvName: string) {
    super(env, kvName);
  }

  private async getCachedTgFilePath(
    fileId: string,
    forceRefresh: boolean = false
  ): Promise<string | null> {
    return getTgFilePath(
      fileId,
      this.env.TG_BOT_TOKEN,
      forceRefresh,
      this.env.TG_API_BASE_URL
    );
  }

  async uploadFile(
    file: File | Blob | Uint8Array,
    metadata: FileMetadata,
    waitUntil?: (p: Promise<any>) => void
  ): Promise<{ key: string }> {
    if (metadata.fileSize > MAX_CHUNK_SIZE) {
      throw new Error(`File size exceeds ${MAX_CHUNK_SIZE}MB`);
    }

    const { fileName } = metadata;

    // 如果不是 File 实例，将其转换为 File
    let finalFile: File;
    if (file instanceof File) {
      finalFile = file;
    } else {
      const extension = fileName.split(".").pop()?.toLowerCase() || "";
      const contentType = getContentTypeByExt(extension);
      finalFile = new File([file as unknown as BlobPart], fileName, {
        type: contentType,
      });
    }

    const { file: processedFile, fileName: processedFileName } =
      await processGifFile(finalFile, fileName);

    const { apiEndpoint, field, fileType, ext } = resolveFileDescriptor(
      processedFile,
      processedFileName
    );

    const formData = new FormData();
    formData.append("chat_id", this.env.TG_CHAT_ID);
    formData.append(field, processedFile);

    const result = await this.sendToTelegram(formData, apiEndpoint);
    if (!result.success) {
      throw new Error(result.message);
    }

    const imageVariantIds =
      fileType === FileType.Image
        ? getTgImageVariantIds(result.data)
        : { fileId: null, previewFileId: null };

    const tgFileId = imageVariantIds.fileId ?? getTgFileId(result.data);
    if (!tgFileId) {
      throw new Error("Failed to extract Telegram file_id");
    }

    // 使用 Telegram 返回的实际文件大小（sendPhoto 会压缩图片）
    const actualFileSize = getTgFileSize(result.data);
    if (actualFileSize !== undefined) {
      metadata.fileSize = actualFileSize;
    }

    // 图片和视频都尽量复用 Telegram 返回的小图能力
    if (fileType === FileType.Image && imageVariantIds.previewFileId) {
      metadata.thumbUrl = `/file/${imageVariantIds.previewFileId}/thumb`;
    }
    if (fileType === FileType.Video) {
      const thumbFileId = getVideoThumbId(result.data);
      if (thumbFileId) {
        metadata.thumbUrl = `/file/${thumbFileId}/thumb`;
      }
    }

    const key = buildKeyId(fileType, tgFileId, ext);

    const kv = this.env[this.kvName];
    if (kv) {
      await kv.put(key, "", { metadata });
    }

    // 图片上传成功后根据全局设置决定是否异步触发 AI 分析，优先使用 Telegram 返回的小图
    if (
      kv &&
      this.env.AI &&
      fileType === FileType.Image &&
      isSupportedImage(processedFile.type, processedFileName)
    ) {
      let enableImageAnalysis = true;
      try {
        const settings = await kvGetJSON<Partial<GeneralSettings>>(
          kv,
          CF.SETTINGS_KEY,
          {
            enableImageAnalysis: true,
          }
        );
        enableImageAnalysis = settings.enableImageAnalysis !== false;
      } catch (err) {
        console.warn(
          "[AI] Failed to read image analysis setting, using default enabled:",
          err
        );
      }

      if (enableImageAnalysis) {
        const enrichTask = analyzeImageAndEnrich(
          this.env,
          kv,
          key,
          processedFile,
          {
            previewFileId: imageVariantIds.previewFileId,
            tgFileId: tgFileId,
          }
        );
        if (waitUntil) {
          waitUntil(enrichTask);
        } else {
          enrichTask.catch((err) =>
            console.warn("[AI] Background enrich failed:", err)
          );
        }
      }
    }

    return { key };
  }

  async uploadStream(
    stream: ReadableStream,
    metadata: FileMetadata,
    waitUntil?: (p: Promise<any>) => void,
    mimeType?: string
  ): Promise<{ key: string }> {
    // Telegram 不支持流式上传，需要转为 Blob
    const response = new Response(stream);
    const blob = await response.blob();
    // 如果提供了 mimeType，创建带类型的 Blob
    const typedBlob = mimeType ? new Blob([blob], { type: mimeType }) : blob;
    return this.uploadFile(typedBlob, metadata, waitUntil);
  }

  /**
   * 上传分片到 Telegram 存储
   * 由基类的 consumeChunk 模板方法调用
   */
  protected async uploadToTarget(
    chunkFile: File | Blob | Uint8Array,
    parentKey: string,
    chunkIndex: number,
    fileName?: string
  ): Promise<{ chunkId: string; thumbUrl?: string }> {
    const formData = new FormData();
    formData.append("chat_id", this.env.TG_CHAT_ID);

    // 确保是 File 实例以便带有文件名
    let fileToUpload: File;
    if (chunkIndex === 0 && fileName) {
      // 如果是第一个分片且有文件名，使用原文件名以帮助Telegram识别文件类型（如视频）
      const blob =
        chunkFile instanceof File
          ? chunkFile
          : new Blob([chunkFile as unknown as BlobPart]);
      const type = chunkFile instanceof File ? chunkFile.type : undefined;
      fileToUpload = new File([blob], fileName, { type });
    } else if (chunkFile instanceof File) {
      fileToUpload = chunkFile;
    } else {
      fileToUpload = new File(
        [chunkFile as unknown as BlobPart],
        `part-${chunkIndex}`
      );
    }

    formData.append("document", fileToUpload);

    const response = await this.sendToTelegram(formData, "sendDocument");
    if (!response.success) throw new Error(response.message);
    const result = response.data;
    const chunkId = result.result.document.file_id;
    let thumbUrl: string | undefined;

    // 尝试获取缩略图
    if (chunkIndex === 0) {
      const thumbFileId = getVideoThumbId(result);
      if (thumbFileId) {
        thumbUrl = `/file/${thumbFileId}/thumb`;
      }
    }

    return { chunkId, thumbUrl };
  }

  async get(key: string, req?: Request, item?: FileRecord): Promise<Response> {
    const { fileId, isChunk } = getFileIdFromKey(key);
    const kv = this.env[this.kvName];
    // 优先获取 Metadata 判断文件类型
    const { value, metadata } = item ?? (await kv.getWithMetadata(key));

    if (!metadata) {
      return failResponse(`Metadata not found for key: ${key}`, 404);
    }

    // 检查是否为分片合并文件（依据 metadata.chunkInfo）
    if (metadata.chunkInfo && isChunk) {
      return await this.getMergedFile(key, req, metadata, value);
    }

    return await this.getSingleFile(key, req, metadata);
  }

  /**
   * 获取单个文件
   */
  private async getSingleFile(
    key: string,
    req: Request | undefined,
    metadata: FileMetadata
  ): Promise<Response> {
    try {
      const { fileId } = getFileIdFromKey(key);
      const ext = key.substring(key.lastIndexOf(".") + 1);
      const contentType = getContentTypeByExt(ext);

      let filePath = await this.getCachedTgFilePath(fileId);
      if (!filePath) {
        return failResponse(`File not found for key: ${key}`, 404);
      }

      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set(
        "Content-Disposition",
        encodeContentDisposition(metadata.fileName)
      );
      headers.set("Cache-Control", "public, max-age=3600");
      headers.set("Accept-Ranges", "bytes");

      const range = req?.headers.get("Range") || null;

      const fetchFromTg = async (currentFilePath: string) => {
        const tgUrl = buildTgFileUrl(
          this.env.TG_BOT_TOKEN,
          currentFilePath,
          this.env.TG_API_BASE_URL
        );
        return range
          ? fetch(tgUrl, { headers: { Range: range } })
          : fetch(tgUrl);
      };

      let tgResp = await fetchFromTg(filePath);

      // Telegram 链接有效期 1 小时，如遇 401/404 错误则强制刷新缓存并重试一次
      if (tgResp.status === 401 || tgResp.status === 404) {
        await tgResp.body?.cancel();
        console.log(
          `[TGAdapter] TG URL expired or invalid (Status: ${tgResp.status}). Retrying for key: ${key}`
        );
        filePath = await this.getCachedTgFilePath(fileId, true);
        if (!filePath) {
          return failResponse(
            `File not found for key: ${key} after retry`,
            404
          );
        }
        tgResp = await fetchFromTg(filePath);
      }

      if (range) {
        const contentRange = tgResp.headers.get("Content-Range");
        const contentLength = tgResp.headers.get("Content-Length");

        if (contentRange) headers.set("Content-Range", contentRange);
        if (contentLength) headers.set("Content-Length", contentLength);

        return new Response(tgResp.body, {
          status: tgResp.status,
          headers,
        });
      }

      const contentLength = tgResp.headers.get("Content-Length");
      if (contentLength) headers.set("Content-Length", contentLength);

      return new Response(tgResp.body, { status: tgResp.status, headers });
    } catch (error) {
      return failResponse(`File not found for key: ${key}`, 404);
    }
  }

  /**
   * 合并分片文件
   */
  private async getMergedFile(
    key: string,
    req: Request | undefined,
    metadata: FileMetadata,
    value: string | ReadableStream | ArrayBuffer | null
  ): Promise<Response> {
    const ext = key.substring(key.lastIndexOf(".") + 1);
    const contentType = getContentTypeByExt(ext);

    if (!metadata.chunkInfo) {
      return failResponse("Invalid metadata: not a chunked file", 400);
    }

    // 解析 chunks
    let chunks: Chunk[] = [];
    try {
      if (value) {
        chunks = JSON.parse(value as string);
      }
    } catch (e) {
      console.error(`[TGAdapter] Failed to parse chunks for ${key}:`, e);
      return failResponse("Failed to parse chunks metadata", 500);
    }

    // 验证分片完整性
    const validation = validateChunksForMerge(chunks, metadata.chunkInfo.total);
    if (!validation.valid) {
      console.error(`[getMergedFile] ${validation.reason}`);
      return failResponse(validation.reason || "Invalid metadata", 425);
    }

    // 排序并计算总大小
    const { sortedChunks, totalSize } = sortChunksAndCalculateSize(chunks);

    // 解析 Range 请求
    const rangeResult = parseRangeHeader(
      req?.headers.get("Range") || null,
      totalSize
    );
    if (req?.headers.has("Range") && !rangeResult) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${totalSize}` },
      });
    }

    // 计算实际响应的字节范围
    const start = rangeResult ? rangeResult.start : 0;
    const end = rangeResult ? rangeResult.end : totalSize - 1;

    // 准备上下文
    const botToken = this.env.TG_BOT_TOKEN;
    const apiBaseUrl = this.env.TG_API_BASE_URL;
    const getFilePath = (fileId: string, forceRefresh = false) =>
      this.getCachedTgFilePath(fileId, forceRefresh);

    const stream = createChunkStream(
      sortedChunks,
      start,
      end,
      async (chunk, range, signal) => {
        const fetchChunk = async (forceRefresh = false) => {
          const filePath = await getFilePath(chunk.file_id, forceRefresh);
          if (!filePath) throw new Error(`Missing chunk ${chunk.idx}`);
          return fetch(buildTgFileUrl(botToken, filePath, apiBaseUrl), {
            signal,
            headers: {
              Range: `bytes=${range.offset}-${range.offset + range.length - 1}`,
            },
          });
        };
        let response = await fetchChunk();
        if (response.status === 401 || response.status === 404) {
          await response.body?.cancel();
          response = await fetchChunk(true);
        }
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error(`Failed to fetch chunk ${chunk.idx}`);
        }
        return response.body;
      }
    );

    const hasRange = Boolean(req?.headers.get("Range"));

    return new Response(stream, {
      status: hasRange ? 206 : 200,
      headers: {
        "Content-Type": contentType,
        ...(hasRange
          ? { "Content-Range": `bytes ${start}-${end}/${totalSize}` }
          : {}),
        "Content-Length": String(end - start + 1),
        "Content-Disposition": encodeContentDisposition(metadata.fileName),
        "Cache-Control": "public, max-age=3600",
        "Accept-Ranges": "bytes",
      },
    });
  }

  async delete(key: string): Promise<{ isDeleted: boolean }> {
    try {
      // Telegram API不支持直接删除文件
      // 只从KV存储中删除文件信息
      await this.env[this.kvName].delete(key);

      return { isDeleted: true };
    } catch (error) {
      return { isDeleted: false };
    }
  }

  // https://core.telegram.org/bots/api#sending-files
  private async sendToTelegram(
    formData: FormData,
    apiEndpoint: string,
    retryCount = 3,
    deadline = Date.now() + 120_000
  ): Promise<ApiResponse<any>> {
    const apiUrl = buildTgApiUrl(
      this.env.TG_BOT_TOKEN,
      apiEndpoint,
      this.env.TG_API_BASE_URL
    );

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(60_000, deadline - Date.now()))
        ),
      });
      const responseData = await response.json().catch(() => ({}));

      if (response.ok && responseData.ok) {
        return { success: true, data: responseData };
      }

      const attempt = 3 - retryCount;
      const backoffMs = Math.min(30000, Math.pow(2, attempt) * 1000);
      const retryAfterSec =
        typeof responseData?.parameters?.retry_after === "number"
          ? responseData.parameters.retry_after
          : undefined;
      const waitMs =
        retryAfterSec !== undefined
          ? Math.max(backoffMs, retryAfterSec * 1000)
          : backoffMs;

      const isPhotoFallback =
        apiEndpoint === "sendPhoto" && response.status === 400;
      const transient = response.status === 429 || response.status >= 500;
      if (
        (!transient && !isPhotoFallback) ||
        waitMs > 30_000 ||
        Date.now() + waitMs >= deadline
      ) {
        return {
          success: false,
          message: `Upload to Telegram failed: ${responseData.description || response.status}`,
        };
      }
      if (retryCount > 0) {
        // 图片类型特殊处理：转为文档方式重试
        if (isPhotoFallback) {
          const newFormData = new FormData();
          newFormData.append("chat_id", formData.get("chat_id") as string);
          newFormData.append("document", formData.get("photo") as File);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          return await this.sendToTelegram(
            newFormData,
            "sendDocument",
            retryCount - 1,
            deadline
          );
        }
        // 其他类型直接重试
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return await this.sendToTelegram(
          formData,
          apiEndpoint,
          retryCount - 1,
          deadline
        );
      }

      return {
        success: false,
        message: `Upload to Telegram failed: ${
          responseData.description || "Unknown error"
        }`,
      };
    } catch (error: any) {
      if (
        retryCount > 0 &&
        Date.now() + Math.pow(2, 3 - retryCount) * 1000 < deadline
      ) {
        const attempt = 3 - retryCount;
        const backoffMs = Math.min(30000, Math.pow(2, attempt) * 1000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return await this.sendToTelegram(
          formData,
          apiEndpoint,
          retryCount - 1,
          deadline
        );
      }
      return {
        success: false,
        message: `Network error occurred: ${
          error.message || "Unknown network error"
        }`,
      };
    }
  }
}
