import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { FILE_API_SCOPES } from "@shared/types";
import { readFileApiBody } from "@utils/file-api-body";
import {
  FILE_API_TOKEN_KEY,
  fileApiTokenStatus,
  getFileApiToken,
  hashFileApiToken,
  encryptFileApiToken,
  decryptFileApiToken,
} from "@utils/file-api-token";
import { fail, ok } from "@utils/response";
import type { Env } from "../types/hono";

export const fileApiSettingsRoutes = new Hono<{ Bindings: Env }>();

fileApiSettingsRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

fileApiSettingsRoutes.onError((error, c) => {
  if (error instanceof HTTPException)
    return fail(c, error.message, error.status);
  console.error("File API settings error:", error);
  return fail(c, "Failed to manage API token", 500);
});

fileApiSettingsRoutes.get("/", async (c) =>
  ok(c, fileApiTokenStatus(await getFileApiToken(c.env)))
);

const optionsSchema = z
  .object({
    scopes: z
      .array(z.enum(FILE_API_SCOPES))
      .min(1)
      .max(3)
      .transform((scopes) => [...new Set(scopes)])
      .default(["files:read", "files:write"]),
    expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
  })
  .strict();

fileApiSettingsRoutes.post("/rotate", async (c) => {
  if (!c.env.JWT_SECRET) return fail(c, "JWT_SECRET is required", 500);
  const bytes = await readFileApiBody(c.req.raw, 4096);
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail(c, "Invalid JSON body", 400);
  }
  const parsed = optionsSchema.safeParse(input);
  if (!parsed.success) return fail(c, "Invalid scopes or expiresInDays", 400);
  const { scopes, expiresInDays } = parsed.data;
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = `ohf_${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const createdAt = Date.now();
  const record = {
    hash: await hashFileApiToken(token),
    scopes,
    createdAt,
    ...(expiresInDays === null
      ? {}
      : { expiresAt: createdAt + expiresInDays * 86_400_000 }),
    fingerprint: token.slice(-8),
    encryptedToken: await encryptFileApiToken(token, c.env.JWT_SECRET),
  };
  await c.env.oh_file_url.put(FILE_API_TOKEN_KEY, JSON.stringify(record));
  return ok(c, { token, status: fileApiTokenStatus(record) });
});

// Explicit administrator action; status polling never reveals the token.
fileApiSettingsRoutes.post("/reveal", async (c) => {
  if (!c.env.JWT_SECRET) return fail(c, "JWT_SECRET is required", 500);
  const record = await getFileApiToken(c.env);
  if (!record) return fail(c, "API token is not configured", 404);
  try {
    return ok(c, {
      token: await decryptFileApiToken(record, c.env.JWT_SECRET),
      status: fileApiTokenStatus(record),
    });
  } catch {
    return fail(
      c,
      "Cannot retrieve this token; reset it to generate a recoverable token",
      409
    );
  }
});

fileApiSettingsRoutes.delete("/", async (c) => {
  await c.env.oh_file_url.delete(FILE_API_TOKEN_KEY);
  return ok(c, fileApiTokenStatus(null));
});
