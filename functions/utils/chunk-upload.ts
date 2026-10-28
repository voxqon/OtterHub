import { SignJWT, jwtVerify } from "jose";
import {
  Chunk,
  FileMetadata,
  MAX_CHUNK_SIZE,
  UploadedChunk,
} from "@shared/types";
import type { KVNamespace } from "../types/hono";
import { TEMP_CHUNK_TTL } from "../types";

export const chunkReceiptPrefix = (key: string) => `upload:${key}:`;
export const chunkReceiptKey = (key: string, index: number) =>
  `${chunkReceiptPrefix(key)}${index}`;

export async function signChunkReceipt(
  key: string,
  chunk: UploadedChunk,
  secret: string
) {
  return new SignJWT({ key, chunk })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("otterhub:chunk")
    .setIssuedAt()
    .setExpirationTime(`${TEMP_CHUNK_TTL}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyChunkReceipt(
  key: string,
  receipt: string,
  secret: string
) {
  const { payload } = await jwtVerify(
    receipt,
    new TextEncoder().encode(secret),
    {
      algorithms: ["HS256"],
      audience: "otterhub:chunk",
    }
  );
  if (payload.key !== key || !payload.chunk)
    throw new Error("Invalid chunk receipt");
  return payload.chunk as UploadedChunk;
}

export async function getStoredChunks(
  kv: KVNamespace,
  key: string,
  value: string | null
): Promise<UploadedChunk[]> {
  const chunks = new Map<number, UploadedChunk>(
    (value ? (JSON.parse(value) as Chunk[]) : []).map((chunk) => [
      chunk.idx,
      chunk,
    ])
  );
  const records = await kv.list({
    prefix: chunkReceiptPrefix(key),
    limit: 1000,
  });
  for (const record of records.keys) {
    const chunk = record.metadata as UploadedChunk | undefined;
    if (chunk) chunks.set(chunk.idx, chunk);
  }
  return [...chunks.values()].sort((a, b) => a.idx - b.idx);
}

export async function finalizeUpload(
  kv: KVNamespace,
  key: string,
  item: { value: string | null; metadata: FileMetadata },
  uploadedChunks: UploadedChunk[]
): Promise<FileMetadata> {
  const { metadata, value } = item;
  if (!metadata?.chunkInfo) throw new Error("Not a chunked file");
  const existing: Chunk[] = value ? JSON.parse(value) : [];
  const chunks = new Map<number, UploadedChunk>(
    existing.map((chunk) => [chunk.idx, chunk])
  );
  for (const chunk of uploadedChunks) chunks.set(chunk.idx, chunk);
  const total = metadata.chunkInfo.total;
  const sorted = [...chunks.values()].sort((a, b) => a.idx - b.idx);
  if (sorted.length !== total) throw new Error("Incomplete upload");
  for (let index = 0; index < total; index++) {
    const chunk = sorted[index];
    const expectedSize = Math.min(
      MAX_CHUNK_SIZE,
      metadata.fileSize - index * MAX_CHUNK_SIZE
    );
    if (chunk.idx !== index || !chunk.file_id || chunk.size !== expectedSize) {
      throw new Error("Invalid chunk manifest");
    }
  }
  if (
    existing.length === total &&
    metadata.chunkInfo.uploadedIndices.length === total
  )
    return metadata;
  const completedMetadata: FileMetadata = {
    ...metadata,
    thumbUrl:
      metadata.thumbUrl ?? sorted.find((chunk) => chunk.thumbUrl)?.thumbUrl,
    chunkInfo: { total, uploadedIndices: sorted.map((chunk) => chunk.idx) },
  };
  // Only completion writes the parent key; independent chunk receipts never overwrite it.
  await kv.put(
    key,
    JSON.stringify(
      sorted.map(({ idx, file_id, size }) => ({ idx, file_id, size }))
    ),
    {
      metadata: completedMetadata,
    }
  );
  return completedMetadata;
}
