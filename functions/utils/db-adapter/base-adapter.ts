import type { DBAdapter, FileRecord } from ".";
import {
  FileMetadata,
  MAX_CHUNK_SIZE,
  TRASH_EXPIRATION_TTL,
  UploadedChunk,
  chunkPrefix,
  trashPrefix,
} from "@shared/types";
import { extractKeyFromTrash } from "./shared-utils";
import { getUniqueFileId } from "../file";
import { TEMP_CHUNK_TTL } from "../../types";
import {
  chunkReceiptKey,
  finalizeUpload,
  getStoredChunks,
} from "../chunk-upload";

export abstract class BaseAdapter implements DBAdapter {
  protected env: any;
  protected kvName: string;
  private pendingChunks = new Map<string, Promise<UploadedChunk>>();

  constructor(env: any, kvName: string) {
    this.env = env;
    this.kvName = kvName;
  }

  abstract uploadFile(
    file: File | Blob | Uint8Array,
    metadata: FileMetadata,
    waitUntil?: (p: Promise<any>) => void
  ): Promise<{ key: string }>;

  abstract uploadStream(
    stream: ReadableStream,
    metadata: FileMetadata,
    waitUntil?: (p: Promise<any>) => void,
    mimeType?: string
  ): Promise<{ key: string }>;

  abstract get(
    key: string,
    req?: Request,
    item?: FileRecord
  ): Promise<Response>;
  abstract delete(key: string): Promise<{ isDeleted: boolean }>;

  async moveToTrash(key: string): Promise<void> {
    if (key.startsWith(trashPrefix))
      throw new Error("File is already in trash");
    const kv = this.env[this.kvName];
    const item = await this.getFileMetadataWithValue(key);
    if (!item) throw new Error("File not found");
    await kv.put(`${trashPrefix}${key}`, item.value || "", {
      metadata: item.metadata,
      expirationTtl: TRASH_EXPIRATION_TTL,
    });
    await kv.delete(key);
  }

  async restoreFromTrash(trashKey: string): Promise<void> {
    if (!trashKey.startsWith(trashPrefix)) throw new Error("Invalid trash key");
    const kv = this.env[this.kvName];
    const item = await this.getFileMetadataWithValue(trashKey);
    if (!item) throw new Error("File not found in trash");
    await kv.put(extractKeyFromTrash(trashKey), item.value || "", {
      metadata: item.metadata,
    });
    await kv.delete(trashKey);
  }

  protected abstract uploadToTarget(
    chunkFile: File | Blob | Uint8Array,
    parentKey: string,
    chunkIndex: number,
    fileName?: string
  ): Promise<string | { chunkId: string; thumbUrl?: string }>;

  protected getTempChunkId(parentKey: string, chunkIndex: number): string {
    const shortFileId =
      parentKey.split("_")[1]?.slice(0, 16) || getUniqueFileId();
    return `${chunkPrefix}${shortFileId}_${chunkIndex}`;
  }

  async uploadChunk(
    key: string,
    chunkIndex: number,
    chunkFile: File | Blob,
    waitUntil?: (promise: Promise<any>) => void
  ): Promise<{ chunkIndex: number; chunk?: UploadedChunk }> {
    const kv = this.env[this.kvName];
    const item = await this.getFileMetadataWithValue(key);
    if (!item) throw new Error("File not found");
    const { metadata, value } = item;
    if (!metadata.chunkInfo) throw new Error("Not a chunked file");
    const expectedSize = Math.min(
      MAX_CHUNK_SIZE,
      metadata.fileSize - chunkIndex * MAX_CHUNK_SIZE
    );
    if (
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex >= metadata.chunkInfo.total ||
      chunkFile.size !== expectedSize
    ) {
      throw new Error("Invalid chunk index or size");
    }

    const completed = (
      value ? (JSON.parse(value) as UploadedChunk[]) : []
    ).find((chunk) => chunk.idx === chunkIndex);
    if (completed) return { chunkIndex, chunk: completed };

    const receiptKey = chunkReceiptKey(key, chunkIndex);
    let pending = this.pendingChunks.get(receiptKey);
    if (!pending) {
      pending = (async () => {
        const saved = (await kv.get(
          receiptKey,
          "json"
        )) as UploadedChunk | null;
        if (saved) return saved;
        const result = await this.uploadToTarget(
          chunkFile,
          key,
          chunkIndex,
          metadata.fileName
        );
        const chunk: UploadedChunk = {
          idx: chunkIndex,
          file_id: typeof result === "string" ? result : result.chunkId,
          size: chunkFile.size,
          ...(typeof result === "string" || !result.thumbUrl
            ? {}
            : { thumbUrl: result.thumbUrl }),
        };
        await kv.put(receiptKey, JSON.stringify(chunk), {
          metadata: chunk,
          expirationTtl: TEMP_CHUNK_TTL,
        });
        return chunk;
      })();
      this.pendingChunks.set(receiptKey, pending);
      const clearPending = () => {
        if (this.pendingChunks.get(receiptKey) === pending)
          this.pendingChunks.delete(receiptKey);
      };
      void pending.then(clearPending, clearPending);
    }

    if (waitUntil) {
      // Compatibility for callers using the original asynchronous upload contract.
      waitUntil(
        pending.then(async () => {
          const chunks = await getStoredChunks(kv, key, value);
          if (chunks.length === metadata.chunkInfo!.total)
            await finalizeUpload(kv, key, item, chunks);
        })
      );
      return { chunkIndex };
    }
    return { chunkIndex, chunk: await pending };
  }

  public async getFileMetadataWithValue(
    key: string
  ): Promise<FileRecord | null> {
    const item = await this.env[this.kvName].getWithMetadata(key);
    return item.metadata
      ? { metadata: item.metadata, value: item.value }
      : null;
  }
}
