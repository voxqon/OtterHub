import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  FileType,
  FileMetadata,
  FileTag,
  chunkPrefix,
  MAX_FILENAME_LENGTH,
  MAX_FILE_SIZE,
  MAX_CHUNK_NUM,
  MAX_CHUNK_SIZE,
} from "@shared/types";
import { DBAdapterFactory } from "@utils/db-adapter";
import { getUniqueFileId, buildKeyId, getFileExt } from "@utils/file";
import { TEMP_CHUNK_TTL } from "types";
import type { Env } from "../../types/hono";
import { fail, ok } from "@utils/response";
import { normalizeUploadTags } from "@utils/upload-tags";
import {
  finalizeUpload,
  getStoredChunks,
  signChunkReceipt,
  verifyChunkReceipt,
} from "@utils/chunk-upload";

export const chunkUploadRoutes = new Hono<{ Bindings: Env }>();

// 初始化分片上传
chunkUploadRoutes.post(
  "/chunk/init",
  zValidator(
    "json",
    z.object({
      fileType: z.enum([
        FileType.Image,
        FileType.Audio,
        FileType.Video,
        FileType.Document,
      ]),
      fileName: z.string().min(1).max(MAX_FILENAME_LENGTH),
      fileSize: z.number().int().positive(),
      totalChunks: z.number().int().positive(),
      tags: z.array(z.enum(FileTag)).optional(),
    })
  ),
  async (c) => {
    const { fileType, fileName, fileSize, totalChunks, tags } =
      c.req.valid("json");

    if (
      fileSize > MAX_FILE_SIZE ||
      totalChunks > MAX_CHUNK_NUM ||
      totalChunks !== Math.ceil(fileSize / MAX_CHUNK_SIZE)
    ) {
      return fail(c, "File size exceeds the limit", 400);
    }

    const fileId = getUniqueFileId();
    const key = buildKeyId(
      fileType,
      `${chunkPrefix}${fileId}`,
      getFileExt(fileName)
    );

    const metadata: FileMetadata = {
      fileName,
      fileSize,
      uploadedAt: Date.now(),
      liked: false,
      tags: normalizeUploadTags(tags),
      chunkInfo: {
        total: totalChunks,
        uploadedIndices: [],
      },
    };

    const kv = c.env.oh_file_url;
    await kv.put(key, "", { metadata, expirationTtl: TEMP_CHUNK_TTL });

    return ok(c, key);
  }
);

chunkUploadRoutes.get(
  "/chunk/progress",
  zValidator(
    "query",
    z.object({
      key: z.string().min(1),
    })
  ),
  async (c) => {
    const { key } = c.req.valid("query");

    try {
      const kv = c.env.oh_file_url;
      const item = await kv.getWithMetadata<FileMetadata>(key);
      const { value, metadata } = item;

      if (!metadata) return fail(c, "Upload not found", 404);
      if (!metadata.chunkInfo) {
        return fail(c, "Not a chunked file", 400);
      }

      c.header("Cache-Control", "private, no-store");
      const chunks = await getStoredChunks(kv, key, value);
      const uploadedIndices = chunks.map((chunk) => chunk.idx);
      const total = metadata.chunkInfo.total || 0;
      const uploaded = uploadedIndices.length;
      const complete = total > 0 && uploaded === total;
      if (complete) await finalizeUpload(kv, key, item, chunks);
      const receipts = await Promise.all(
        chunks.map((chunk) => signChunkReceipt(key, chunk, c.env.JWT_SECRET))
      );

      return ok(c, { uploadedIndices, uploaded, total, complete, receipts });
    } catch (error: any) {
      console.error(`Get chunk progress error: ${error.message}`);
      return fail(c, error.message, 400);
    }
  }
);

chunkUploadRoutes.post(
  "/chunk/complete",
  zValidator(
    "json",
    z.object({
      key: z.string().min(1),
      receipts: z.array(z.string().min(1)).max(MAX_CHUNK_NUM),
    })
  ),
  async (c) => {
    const { key, receipts } = c.req.valid("json");
    if (!c.env.JWT_SECRET) return fail(c, "JWT_SECRET is required", 500);
    const item = await c.env.oh_file_url.getWithMetadata<FileMetadata>(key);
    if (!item.metadata) return fail(c, "Upload not found", 404);
    let chunks;
    try {
      chunks = await Promise.all(
        receipts.map((receipt) =>
          verifyChunkReceipt(key, receipt, c.env.JWT_SECRET)
        )
      );
    } catch {
      return fail(c, "Invalid or expired chunk receipt", 400);
    }
    try {
      const metadata = await finalizeUpload(
        c.env.oh_file_url,
        key,
        item,
        chunks
      );
      return ok(c, metadata);
    } catch (error: any) {
      const invalid =
        error.message === "Incomplete upload" ||
        error.message === "Invalid chunk manifest" ||
        error.message === "Not a chunked file";
      return fail(
        c,
        invalid ? error.message : "Failed to finalize upload",
        invalid ? 400 : 503
      );
    }
  }
);

// 上传分片
chunkUploadRoutes.post("/chunk", async (c) => {
  try {
    const formData = await c.req.formData();
    const key = formData.get("key") as string;
    const rawChunkIndex = formData.get("chunkIndex");
    const chunkIndex =
      typeof rawChunkIndex === "string" && /^\d+$/.test(rawChunkIndex)
        ? Number(rawChunkIndex)
        : NaN;
    const chunk = formData.get("chunkFile") as File;
    const returnReceipt = formData.get("returnReceipt") === "true";

    if (
      typeof key !== "string" ||
      !key ||
      !Number.isSafeInteger(chunkIndex) ||
      !(chunk instanceof File) ||
      chunk.size < 1 ||
      chunk.size > MAX_CHUNK_SIZE
    ) {
      return fail(c, "Missing required parameters", 400);
    }
    if (returnReceipt && !c.env.JWT_SECRET)
      return fail(c, "JWT_SECRET is required", 500);

    const db = DBAdapterFactory.getAdapter(c.env);
    const result = await db.uploadChunk(
      key,
      chunkIndex,
      chunk,
      returnReceipt ? undefined : c.executionCtx.waitUntil.bind(c.executionCtx)
    );
    if (returnReceipt && result.chunk) {
      const receipt = await signChunkReceipt(
        key,
        result.chunk,
        c.env.JWT_SECRET
      );
      return ok(c, { chunkIndex: result.chunkIndex, receipt });
    }

    return ok(c, result.chunkIndex);
  } catch (error: any) {
    console.error(`Upload chunk error: ${error.message}`);
    const invalid =
      /^(File not found|Not a chunked file|Invalid chunk index or size)$/.test(
        error.message
      );
    return fail(
      c,
      invalid ? error.message : "Failed to upload chunk",
      invalid ? 400 : 503
    );
  }
});
