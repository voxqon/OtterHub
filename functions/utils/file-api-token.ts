import { z } from "zod";
import { FILE_API_SCOPES, type FileApiTokenStatus } from "@shared/types";
import type { Env } from "../types/hono";

export const FILE_API_TOKEN_KEY = "oh_file_api_token";

const tokenRecordSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  scopes: z.array(z.enum(FILE_API_SCOPES)).min(1),
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive().optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{8}$/),
  encryptedToken: z
    .string()
    .regex(/^v1\.[a-f0-9]{24}\.[a-f0-9]{168}$/)
    .optional(),
});

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const unhex = (value: string) =>
  Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
const tokenContext = encoder.encode("otterhub:file-api:encryption:v1");

async function encryptionKey(secret: string) {
  if (!secret) throw new Error("JWT_SECRET is required");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`otterhub:file-api:encryption:v1:${secret}`)
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptFileApiToken(token: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: tokenContext },
    await encryptionKey(secret),
    encoder.encode(token)
  );
  return `v1.${hex(iv)}.${hex(new Uint8Array(encrypted))}`;
}

export async function decryptFileApiToken(
  record: z.infer<typeof tokenRecordSchema>,
  secret: string
) {
  if (!record.encryptedToken)
    throw new Error("Token must be reset before retrieval");
  const [, iv, encrypted] = record.encryptedToken.split(".");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unhex(iv), additionalData: tokenContext },
    await encryptionKey(secret),
    unhex(encrypted)
  );
  const token = new TextDecoder().decode(decrypted);
  if (
    !/^ohf_[a-f0-9]{64}$/.test(token) ||
    (await hashFileApiToken(token)) !== record.hash
  )
    throw new Error("Invalid encrypted token");
  return token;
}

export async function hashFileApiToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function getFileApiToken(env: Env) {
  const raw = await env.oh_file_url.get(FILE_API_TOKEN_KEY);
  if (!raw) return null;
  try {
    return tokenRecordSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function fileApiTokenStatus(
  record: z.infer<typeof tokenRecordSchema> | null
): FileApiTokenStatus {
  if (!record) return { configured: false, enabled: false, scopes: [] };
  const { scopes, createdAt, expiresAt, fingerprint } = record;
  return {
    configured: true,
    enabled: expiresAt === undefined || expiresAt > Date.now(),
    scopes,
    createdAt,
    expiresAt,
    fingerprint,
    recoverable: !!record.encryptedToken,
  };
}
