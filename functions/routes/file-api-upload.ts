import { Hono } from "hono";
import { z } from "zod";
import {
  FileTag,
  FileType,
  MAX_CHUNK_NUM,
  MAX_CHUNK_SIZE,
  MAX_FILE_SIZE,
  MAX_FILENAME_LENGTH,
  MAX_DESC_LENGTH,
  chunkPrefix,
  type FileApiScope,
  type FileMetadata,
} from "@shared/types";
import { requireFileApiScope } from "../middleware/file-api-auth";
import { DBAdapterFactory } from "@utils/db-adapter";
import { buildKeyId, getFileExt, getUniqueFileId } from "@utils/file";
import { readFileApiFormData, readFileApiJson } from "@utils/file-api-body";
import {
  finalizeUpload,
  getStoredChunks,
  signChunkReceipt,
  verifyChunkReceipt,
} from "@utils/chunk-upload";
import { TEMP_CHUNK_TTL } from "../types";
import type { Env } from "../types/hono";
import { fail, ok } from "@utils/response";

export const fileApiUploadRoutes = new Hono<{
  Bindings: Env;
  Variables: { fileApiScopes: FileApiScope[] };
}>();

// Progress may finalize an upload, so every operation requires write access.
fileApiUploadRoutes.use("*", requireFileApiScope("files:write"));
fileApiUploadRoutes.use("*", async (c, next) => {
  if (!c.env.JWT_SECRET) return fail(c, "JWT_SECRET is required", 500);
  await next();
});

const keySchema = z
  .string()
  .max(512)
  .regex(/^(img|audio|video|doc):chunk_[^/\\\x00-\x1f\x7f]+$/);
const initSchema = z
  .object({
    fileType: z.enum([
      FileType.Image,
      FileType.Audio,
      FileType.Video,
      FileType.Document,
    ]),
    fileName: z
      .string()
      .min(1)
      .max(MAX_FILENAME_LENGTH)
      .refine((name) => !/[/\\\x00-\x1f\x7f]/.test(name)),
    fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
    totalChunks: z.number().int().min(1).max(MAX_CHUNK_NUM),
    tags: z
      .array(z.enum(FileTag))
      .max(2)
      .default([])
      .transform((tags) => [...new Set(tags)]),
    desc: z.string().max(MAX_DESC_LENGTH).default(""),
  })
  .strict()
  .refine(
    (input) => input.totalChunks === Math.ceil(input.fileSize / MAX_CHUNK_SIZE)
  );
const completeSchema = z
  .object({
    key: keySchema,
    receipts: z.array(z.string().min(1).max(4096)).max(MAX_CHUNK_NUM),
  })
  .strict();

fileApiUploadRoutes.post("/chunk/init", async (c) => {
  const parsed = initSchema.safeParse(await readFileApiJson(c.req.raw, 8192));
  if (!parsed.success)
    return fail(
      c,
      "Invalid upload parameters; maximum 1000 MiB (50 x 20 MiB)",
      400
    );
  const { fileType, fileName, fileSize, totalChunks, tags, desc } = parsed.data;
  const key = buildKeyId(
    fileType,
    `${chunkPrefix}${getUniqueFileId()}`,
    getFileExt(fileName)
  );
  const metadata: FileMetadata = {
    fileName,
    fileSize,
    uploadedAt: Date.now(),
    liked: false,
    tags,
    desc,
    chunkInfo: { total: totalChunks, uploadedIndices: [] },
  };
  await c.env.oh_file_url.put(key, "", {
    metadata,
    expirationTtl: TEMP_CHUNK_TTL,
  });
  return ok(c, key);
});

fileApiUploadRoutes.post("/chunk", async (c) => {
  const form = await readFileApiFormData(c.req.raw, MAX_CHUNK_SIZE + 64 * 1024);
  const key = keySchema.safeParse(form.get("key"));
  const rawIndex = form.get("chunkIndex");
  const chunkIndex =
    typeof rawIndex === "string" && /^\d+$/.test(rawIndex)
      ? Number(rawIndex)
      : NaN;
  const file = form.get("chunkFile");
  if (
    !key.success ||
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= MAX_CHUNK_NUM ||
    !(file instanceof File) ||
    file.size < 1 ||
    ["key", "chunkIndex", "chunkFile"].some(
      (field) => form.getAll(field).length !== 1
    )
  ) {
    return fail(c, "Invalid key, chunkIndex or chunkFile", 400);
  }
  if (file.size > MAX_CHUNK_SIZE) return fail(c, "Chunk exceeds 20 MiB", 413);
  try {
    // Wait for storage confirmation; never return a receipt for queued work.
    const result = await DBAdapterFactory.getAdapter(c.env).uploadChunk(
      key.data,
      chunkIndex,
      file
    );
    if (!result.chunk) return fail(c, "Failed to upload chunk", 503);
    const receipt = await signChunkReceipt(
      key.data,
      result.chunk,
      c.env.JWT_SECRET
    );
    return ok(c, { chunkIndex: result.chunkIndex, receipt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "File not found") return fail(c, "Upload not found", 404);
    if (/^(Not a chunked file|Invalid chunk index or size)$/.test(message))
      return fail(c, message, 400);
    console.error("File API chunk storage failed:", error);
    return fail(c, "Failed to upload chunk", 503);
  }
});

fileApiUploadRoutes.get("/chunk/progress", async (c) => {
  const parsed = keySchema.safeParse(c.req.query("key"));
  if (!parsed.success) return fail(c, "Invalid upload key", 400);
  const key = parsed.data;
  const kv = c.env.oh_file_url;
  const item = await kv.getWithMetadata<FileMetadata>(key);
  if (!item.metadata) return fail(c, "Upload not found", 404);
  if (!item.metadata.chunkInfo) return fail(c, "Not a chunked file", 400);
  try {
    const chunks = await getStoredChunks(kv, key, item.value);
    const uploadedIndices = chunks.map((chunk) => chunk.idx);
    const total = item.metadata.chunkInfo.total;
    const complete = total > 0 && chunks.length === total;
    if (complete) await finalizeUpload(kv, key, item, chunks);
    const receipts = await Promise.all(
      chunks.map((chunk) => signChunkReceipt(key, chunk, c.env.JWT_SECRET))
    );
    return ok(c, {
      uploadedIndices,
      uploaded: chunks.length,
      total,
      complete,
      receipts,
    });
  } catch (error) {
    console.error("File API chunk progress failed:", error);
    return fail(c, "Failed to read upload progress", 503);
  }
});

fileApiUploadRoutes.post("/chunk/complete", async (c) => {
  const parsed = completeSchema.safeParse(
    await readFileApiJson(c.req.raw, 128 * 1024)
  );
  if (!parsed.success) return fail(c, "Invalid key or receipts", 400);
  const { key, receipts } = parsed.data;
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
    const metadata = await finalizeUpload(c.env.oh_file_url, key, item, chunks);
    const {
      telegramMessages: _messages,
      thumbUrl: _thumb,
      ...visible
    } = metadata;
    return ok(c, visible);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      /^(Incomplete upload|Invalid chunk manifest|Not a chunked file)$/.test(
        message
      )
    )
      return fail(c, message, 400);
    console.error("File API chunk completion failed:", error);
    return fail(c, "Failed to finalize upload", 503);
  }
});
