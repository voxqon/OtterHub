import { Hono } from "hono";
import { MAX_CHUNK_SIZE, MAX_FILENAME_LENGTH, type FileMetadata } from "@shared/types";
import { DBAdapterFactory } from "@utils/db-adapter";
import { fail, ok } from "@utils/response";
import type { Env } from "../types/hono";

export const publicApiRoutes = new Hono<{ Bindings: Env }>();
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

publicApiRoutes.post("/upload", async (c) => {
  const secret = await c.env.oh_file_url.get("oh_public_api_secret");
  const timestamp = c.req.header("X-Otter-Timestamp") || "";
  const encodedName = c.req.header("X-Otter-Filename") || "";
  const digest = c.req.header("X-Otter-Content-SHA256") || "";
  const signature = c.req.header("X-Otter-Signature") || "";
  if (!secret || !/^\d{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !/^[a-f0-9]{64}$/.test(digest) || !/^[a-f0-9]{64}$/.test(signature)) {
    return fail(c, "Invalid or expired signature", 401);
  }

  let fileName: string;
  try {
    fileName = decodeURIComponent(encodedName);
  } catch {
    return fail(c, "Invalid filename", 400);
  }
  if (!fileName || fileName.length > MAX_FILENAME_LENGTH || /[\/\\\x00-\x1f\x7f]/.test(fileName)) {
    return fail(c, "Invalid filename", 400);
  }
  const canonical = `POST\n/public/upload\n${timestamp}\n${encodedName}\n${digest}`;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const signatureBytes = new Uint8Array(signature.match(/../g)!.map((pair) => parseInt(pair, 16)));
  if (!await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(canonical))) {
    return fail(c, "Invalid or expired signature", 401);
  }

  const declaredSize = c.req.header("Content-Length");
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_CHUNK_SIZE)) {
    return fail(c, "File exceeds 20 MiB", 413);
  }
  if (!c.req.raw.body) return fail(c, "File body is required", 400);
  const reader = c.req.raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CHUNK_SIZE) {
        await reader.cancel();
        return fail(c, "File exceeds 20 MiB", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== digest) {
      return fail(c, "File digest mismatch", 400);
    }
    const metadata: FileMetadata = { fileName, fileSize: size, uploadedAt: Date.now(), liked: false, tags: [] };
    const file = new File([bytes], fileName);
    const result = await DBAdapterFactory.getAdapter(c.env).uploadFile(
      file, metadata, c.executionCtx.waitUntil.bind(c.executionCtx)
    );
    return ok(c, { key: result.key });
  } catch (error) {
    console.error("Public upload error:", error);
    return fail(c, "Failed to upload file", 500);
  }
});
