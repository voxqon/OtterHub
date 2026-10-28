import { t } from "@/lib/i18n/core";
import { client } from "./client";
import { API_URL, unwrap } from "./config";
import {
  ApiResponse,
  ChunkUploadResult,
  ChunkUploadProgress,
  ChunkUploadInitPayload,
  FileMetadata,
  FileTag,
  ListFilesResponse,
  SingleUploadPayload,
} from "@shared/types";
import { ListFilesRequest } from "@/lib/types";
import { createUploadQueue } from "./upload-queue";

const runUpload = createUploadQueue(2);

export type UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type ChunkProcessingProgress = ChunkUploadProgress;

function redirectToLoginIfNeeded() {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  const currentUrl = window.location.href;
  const redirectUrl = `/login?redirect=${encodeURIComponent(currentUrl)}`;
  window.location.href = redirectUrl;
}

async function parseApiResponse<T>(raw: string): Promise<T> {
  let body: ApiResponse<T>;
  try {
    body = JSON.parse(raw) as ApiResponse<T>;
  } catch {
    throw new Error(raw || t("请求失败"));
  }

  if (!body.success) {
    throw new Error(body.message || t("请求失败"));
  }

  return body.data as T;
}

function xhrPostForm<T>(
  url: string,
  form: FormData,
  onProgress?: (p: UploadProgress) => void
): Promise<T> {
  return runUpload(
    () =>
      new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.withCredentials = true;
        xhr.timeout = 180_000;

        xhr.upload.onprogress = (e) => {
          if (!onProgress) return;
          const total = e.total || 0;
          const loaded = e.loaded || 0;
          const percent =
            total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          onProgress({ loaded, total, percent });
        };

        xhr.onload = async () => {
          if (xhr.status === 401) {
            redirectToLoginIfNeeded();
            reject(new Error("Unauthorized"));
            return;
          }

          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
            return;
          }

          try {
            const data = await parseApiResponse<T>(xhr.responseText);
            resolve(data);
          } catch (err) {
            reject(err);
          }
        };

        xhr.onerror = () => reject(new Error(t("网络错误")));
        xhr.onabort = () => reject(new Error(t("请求已取消")));
        xhr.ontimeout = () =>
          reject(new Error(t("上传超时，请重试或继续上传")));

        xhr.send(form);
      })
  );
}

/**
 * 上传文件
 */
export async function uploadFile(file: File, nsfw?: boolean): Promise<string> {
  return uploadFileWithProgress(file, { nsfw });
}

export async function uploadFileWithProgress(
  file: File,
  options: SingleUploadPayload,
  onProgress?: (p: UploadProgress) => void
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("nsfw", options.nsfw ? "true" : "false");
  form.append("tags", JSON.stringify(options.tags ?? []));

  const url = `${API_URL}/upload`;
  return xhrPostForm<string>(url, form, onProgress);
}

/**
 * 初始化分片上传
 */
export async function uploadChunkInit(
  payload: ChunkUploadInitPayload
): Promise<string> {
  return unwrap<string>(
    client.upload.chunk.init.$post({
      json: payload,
    })
  );
}

/**
 * 上传分片
 */
export async function uploadChunk(
  key: string,
  chunkIndex: number,
  chunkFile: File | Blob
): Promise<ChunkUploadResult> {
  return uploadChunkWithProgress(key, chunkIndex, chunkFile);
}

export async function uploadChunkWithProgress(
  key: string,
  chunkIndex: number,
  chunkFile: File | Blob,
  onProgress?: (p: UploadProgress) => void
): Promise<ChunkUploadResult> {
  const form = new FormData();
  form.append("key", key);
  form.append("chunkIndex", chunkIndex.toString());
  form.append("chunkFile", chunkFile);
  form.append("returnReceipt", "true");

  const url = `${API_URL}/upload/chunk`;
  return xhrPostForm<ChunkUploadResult>(url, form, onProgress);
}

export async function completeChunkUpload(
  key: string,
  receipts: string[]
): Promise<FileMetadata> {
  return unwrap<FileMetadata>(
    client.upload.chunk.complete.$post({ json: { key, receipts } })
  );
}

export async function getUploadChunkProgress(
  key: string
): Promise<ChunkProcessingProgress> {
  return unwrap<ChunkProcessingProgress>(
    client.upload.chunk.progress.$get({
      query: { key },
    })
  );
}

/**
 * 获取文件列表
 */
export async function getFileList(
  params?: ListFilesRequest
): Promise<ListFilesResponse> {
  const query: Record<string, string> = {};
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) query[k] = String(v);
    });
  }

  return unwrap<ListFilesResponse>(
    client.file.list.$get({
      query: query,
    })
  );
}

/**
 * 获取文件预览/下载 URL
 */
export function getFileUrl(key: string): string {
  return `${API_URL}/file/${key}`;
}

export function getFileDownloadUrl(key: string): string {
  return `${API_URL}/file/${key}/download`;
}

/**
 * 获取回收站文件 URL
 */
export function getTrashFileUrl(key: string): string {
  return `${API_URL}/trash/${key}`;
}

/**
 * 彻底删除文件
 */
export async function deleteFile(key: string): Promise<boolean> {
  await unwrap(
    client.file[":key"].$delete({
      param: { key },
    })
  );
  return true;
}

/**
 * 移动文件到回收站
 */
export async function moveToTrash(key: string): Promise<boolean> {
  await unwrap(
    client.trash[":key"].move.$post({
      param: { key },
    })
  );
  return true;
}

/**
 * 从回收站恢复文件
 */
export async function restoreFile(key: string): Promise<boolean> {
  await unwrap(
    client.trash[":key"].restore.$post({
      param: { key },
    })
  );
  return true;
}

/**
 * 切换收藏状态
 */
export async function toggleLike(key: string): Promise<boolean> {
  await unwrap(
    client.file[":key"]["toggle-like"].$post({
      param: { key },
    })
  );
  return true;
}

/**
 * 编辑文件元数据
 */
export async function editMetadata(
  key: string,
  updates: { fileName?: string; tags?: FileTag[]; desc?: string }
): Promise<{ metadata: any }> {
  const data = await unwrap<any>(
    client.file[":key"].meta.$patch({
      param: { key },
      json: updates,
    })
  );
  return { metadata: data };
}

/**
 * AI分析图片生成描述，blob 为前端已压缩的图片
 */
export async function analyzeImage(
  key: string,
  blob: Blob
): Promise<{ desc: string }> {
  const formData = new FormData();
  formData.append("image", blob, "image.jpg");
  const res = await fetch(
    `${API_URL}/file/${encodeURIComponent(key)}/analyze`,
    {
      method: "POST",
      body: formData,
      credentials: "include",
    }
  );
  return unwrap<{ desc: string }>(res);
}
