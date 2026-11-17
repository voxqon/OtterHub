// Node.js >= 20.9. Keep credentials in the environment, never in this script.
// BASE_URL=https://your-host FILE_API_TOKEN=ohf_... node file-api-upload.mjs large.bin
import { open, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";

const CHUNK_SIZE = 20 * 1024 * 1024;
const base = process.env.BASE_URL?.replace(/\/+$/, "");
const token = process.env.FILE_API_TOKEN;
const filename = process.argv[2];
if (!base || !token || !filename)
  throw new Error(
    "Set BASE_URL and FILE_API_TOKEN, then run: node file-api-upload.mjs <file>"
  );
if (!/^https?:$/.test(new URL(base).protocol))
  throw new Error("BASE_URL must be an HTTP(S) URL");
const filePath = resolve(filename);
const statePath = `${filePath}.otterhub-upload.json`;
const file = await open(filePath, "r");

async function api(path, options = {}) {
  const response = await fetch(`${base}/api/v1${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status}: invalid JSON response`);
  }
  if (!response.ok || !body.success)
    throw new Error(
      `HTTP ${response.status}: ${body.message || "request failed"}`
    );
  return body.data;
}
const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

try {
  const stat = await file.stat();
  if (!stat.isFile() || stat.size < 1 || stat.size > CHUNK_SIZE * 50)
    throw new Error("File must contain 1 byte to 1000 MiB");
  const totalChunks = Math.ceil(stat.size / CHUNK_SIZE);
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const save = async () => {
    await writeFile(`${statePath}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${statePath}.tmp`, statePath);
  };
  if (state) {
    if (
      state.base !== base ||
      state.size !== stat.size ||
      state.mtime !== stat.mtimeMs ||
      typeof state.key !== "string" ||
      !state.receipts ||
      typeof state.receipts !== "object"
    )
      throw new Error(
        "State does not match this host/file. Use the original file, or move the state file aside to start a new upload."
      );
  } else {
    const key = await api(
      "/upload/chunk/init",
      json({
        fileType: process.env.FILE_TYPE || "doc",
        fileName: basename(filePath),
        fileSize: stat.size,
        totalChunks,
        tags: ["private"],
      })
    );
    state = { base, size: stat.size, mtime: stat.mtimeMs, key, receipts: {} };
    await save();
  }
  const progress = await api(
    `/upload/chunk/progress?key=${encodeURIComponent(state.key)}`
  );
  progress.uploadedIndices.forEach((index, position) => {
    state.receipts[index] = progress.receipts[position];
  });
  await save();
  for (let index = 0; index < totalChunks; index++) {
    if (state.receipts[index]) continue;
    const offset = index * CHUNK_SIZE;
    const length = Math.min(CHUNK_SIZE, stat.size - offset);
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await file.read(
        buffer,
        read,
        length - read,
        offset + read
      );
      if (!bytesRead) throw new Error("File changed or ended during upload");
      read += bytesRead;
    }
    const form = new FormData();
    form.append("key", state.key);
    form.append("chunkIndex", String(index));
    form.append("chunkFile", new Blob([buffer]), `part-${index}`);
    form.append("returnReceipt", "true");
    const result = await api("/upload/chunk", { method: "POST", body: form });
    state.receipts[index] = result.receipt;
    await save();
    console.log(`Uploaded ${index + 1}/${totalChunks}`);
  }
  const result = await api(
    "/upload/chunk/complete",
    json({
      key: state.key,
      receipts: Array.from(
        { length: totalChunks },
        (_, index) => state.receipts[index]
      ),
    })
  );
  console.log(JSON.stringify({ key: state.key, metadata: result }, null, 2));
  await unlink(statePath);
} finally {
  await file.close();
}
