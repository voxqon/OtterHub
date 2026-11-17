import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  FileTag,
  MAX_CHUNK_SIZE,
  MAX_DESC_LENGTH,
  MAX_FILENAME_LENGTH,
  type FileApiScope,
  type FileMetadata,
} from "@shared/types";
import { fileApiAuth, requireFileApiScope } from "../middleware/file-api-auth";
import { DBAdapterFactory } from "@utils/db-adapter";
import { deleteFileCache } from "@utils/cache";
import { readFileApiBody } from "@utils/file-api-body";
import { fail, ok } from "@utils/response";
import type { Env } from "../types/hono";
import { fileApiUploadRoutes } from "./file-api-upload";

export const fileApiRoutes = new Hono<{
  Bindings: Env;
  Variables: { fileApiScopes: FileApiScope[] };
}>();

fileApiRoutes.use("*", fileApiAuth);
fileApiRoutes.onError((error, c) => {
  if (error instanceof HTTPException)
    return fail(c, error.message, error.status);
  console.error("File API error:", error);
  return fail(c, "File operation failed", 500);
});

fileApiRoutes.route("/upload", fileApiUploadRoutes);

const fileNameSchema = z
  .string()
  .min(1)
  .max(MAX_FILENAME_LENGTH)
  .refine((name) => !/[\/\\\x00-\x1f\x7f]/.test(name), "Invalid filename");
const tagsSchema = z
  .array(z.enum(FileTag))
  .max(2)
  .transform((tags) => [...new Set(tags)]);
const metadataSchema = z
  .object({
    fileName: fileNameSchema.optional(),
    tags: tagsSchema.optional(),
    desc: z.string().max(MAX_DESC_LENGTH).optional(),
    liked: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(1000).default(50),
    cursor: z.string().max(4096).optional(),
    fileType: z.enum(["img", "audio", "video", "doc"]).optional(),
  })
  .strict();

// Never expose storage identifiers, Telegram message references, settings or shares.
function fileView(key: string, metadata: FileMetadata) {
  const { fileName, fileSize, uploadedAt, liked, tags, desc, chunkInfo } =
    metadata;
  return {
    key,
    metadata: {
      fileName,
      fileSize,
      uploadedAt,
      liked,
      tags: tags ?? [],
      desc,
      chunkInfo,
    },
  };
}

fileApiRoutes.get("/files", requireFileApiScope("files:read"), async (c) => {
  const parsed = listSchema.safeParse(c.req.query());
  if (!parsed.success) return fail(c, "Invalid list parameters", 400);
  const { limit, cursor, fileType } = parsed.data;
  const result = await c.env.oh_file_url.list({
    limit,
    cursor,
    prefix: fileType ? `${fileType}:` : undefined,
  });
  return ok(c, {
    files: result.keys
      .filter(
        (item: { name: string; metadata?: FileMetadata }) =>
          /^(img|audio|video|doc):/.test(item.name) && item.metadata
      )
      .map((item: { name: string; metadata: FileMetadata }) =>
        fileView(item.name, item.metadata)
      ),
    list_complete: result.list_complete,
    cursor: result.list_complete ? null : result.cursor,
  });
});

fileApiRoutes.post("/files", requireFileApiScope("files:write"), async (c) => {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return fail(c, "Use multipart/form-data with a file field", 415);
  }
  const bytes = await readFileApiBody(c.req.raw, MAX_CHUNK_SIZE + 64 * 1024);
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    return fail(c, "Invalid multipart body", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1) {
    return fail(c, "Exactly one file field is required", 400);
  }
  if (file.size > MAX_CHUNK_SIZE) return fail(c, "File exceeds 20 MiB", 413);
  let tags: unknown = [];
  try {
    const rawTags = form.get("tags");
    if (rawTags !== null) {
      if (typeof rawTags !== "string") return fail(c, "Invalid tags", 400);
      tags = JSON.parse(rawTags);
    }
  } catch {
    return fail(c, "Tags must be a JSON array", 400);
  }
  const parsed = metadataSchema.safeParse({
    fileName: file.name,
    tags,
    desc: form.get("desc") ?? "",
  });
  if (!parsed.success)
    return fail(c, "Invalid filename, tags or description", 400);
  const metadata: FileMetadata = {
    fileName: parsed.data.fileName!,
    fileSize: file.size,
    uploadedAt: Date.now(),
    liked: false,
    tags: parsed.data.tags,
    desc: parsed.data.desc,
  };
  const { key } = await DBAdapterFactory.getAdapter(c.env).uploadFile(
    file,
    metadata,
    c.executionCtx.waitUntil.bind(c.executionCtx)
  );
  c.header("Location", `/api/v1/files/${encodeURIComponent(key)}`);
  return ok(c, fileView(key, metadata), undefined, 201);
});

const validateFileKey = async (
  c: Parameters<typeof fileApiAuth>[0],
  next: () => Promise<void>
) => {
  const key = c.req.param("key") ?? "";
  if (
    key.length > 512 ||
    !/^(img|audio|video|doc):[^/\\\x00-\x1f\x7f]+$/.test(key)
  ) {
    return fail(c, "Invalid file key", 400);
  }
  await next();
};
fileApiRoutes.use("/files/:key", validateFileKey);
fileApiRoutes.use("/files/:key/*", validateFileKey);

fileApiRoutes.get(
  "/files/:key",
  requireFileApiScope("files:read"),
  async (c) => {
    const key = c.req.param("key");
    const item = await DBAdapterFactory.getAdapter(
      c.env
    ).getFileMetadataWithValue(key);
    return item
      ? ok(c, fileView(key, item.metadata))
      : fail(c, "File not found", 404);
  }
);

fileApiRoutes.get(
  "/files/:key/content",
  requireFileApiScope("files:read"),
  async (c) => {
    const key = c.req.param("key");
    const db = DBAdapterFactory.getAdapter(c.env);
    const item = await db.getFileMetadataWithValue(key);
    if (!item) return fail(c, "File not found", 404);
    const response = await db.get(key, c.req.raw, item);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }
);

fileApiRoutes.patch(
  "/files/:key",
  requireFileApiScope("files:write"),
  async (c) => {
    if (
      !/^application\/json(?:\s*;|$)/i.test(c.req.header("Content-Type") ?? "")
    ) {
      return fail(c, "Use application/json", 415);
    }
    const bytes = await readFileApiBody(c.req.raw, 16 * 1024);
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return fail(c, "Invalid JSON body", 400);
    }
    const parsed = metadataSchema.safeParse(input);
    if (!parsed.success) return fail(c, "Invalid metadata fields", 400);
    const key = c.req.param("key");
    const item = await DBAdapterFactory.getAdapter(
      c.env
    ).getFileMetadataWithValue(key);
    if (!item) return fail(c, "File not found", 404);
    const metadata = { ...item.metadata, ...parsed.data };
    await c.env.oh_file_url.put(key, item.value ?? "", { metadata });
    await deleteFileCache(new URL(c.req.url).origin, key);
    return ok(c, fileView(key, metadata));
  }
);

fileApiRoutes.delete(
  "/files/:key",
  requireFileApiScope("files:delete"),
  async (c) => {
    const key = c.req.param("key");
    const permanent = c.req.query("permanent");
    if (
      permanent !== undefined &&
      permanent !== "true" &&
      permanent !== "false"
    ) {
      return fail(c, "permanent must be true or false", 400);
    }
    const db = DBAdapterFactory.getAdapter(c.env);
    if (!(await db.getFileMetadataWithValue(key)))
      return fail(c, "File not found", 404);
    if (permanent === "true") {
      const result = await db.delete(key);
      if (!result.isDeleted)
        return fail(c, "Failed to permanently delete file", 500);
    } else {
      await db.moveToTrash(key);
    }
    await deleteFileCache(new URL(c.req.url).origin, key);
    return ok(c, { key, deleted: true, permanent: permanent === "true" });
  }
);
