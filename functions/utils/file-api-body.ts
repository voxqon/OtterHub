import { HTTPException } from "hono/http-exception";

export async function readFileApiJson(
  request: Request,
  limit: number
): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") ?? ""
    )
  ) {
    throw new HTTPException(415, { message: "Use application/json" });
  }
  const bytes = await readFileApiBody(request, limit);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
}

export async function readFileApiFormData(
  request: Request,
  limit: number
): Promise<FormData> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new HTTPException(415, { message: "Use multipart/form-data" });
  }
  const bytes = await readFileApiBody(request, limit);
  try {
    return await new Response(bytes, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new HTTPException(400, { message: "Invalid multipart body" });
  }
}

// Count actual bytes even when Content-Length is missing or smaller than the body.
export async function readFileApiBody(
  request: Request,
  limit: number
): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get("Content-Length");
  if (length !== null && !/^\d+$/.test(length)) {
    throw new HTTPException(400, { message: "Invalid Content-Length" });
  }
  if (length !== null && Number(length) > limit) {
    throw new HTTPException(413, { message: "Request body is too large" });
  }
  if (!request.body)
    throw new HTTPException(400, { message: "Request body is required" });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HTTPException(413, { message: "Request body is too large" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
