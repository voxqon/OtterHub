import { createMiddleware } from "hono/factory";
import type { FileApiScope } from "@shared/types";
import { getFileApiToken, hashFileApiToken } from "@utils/file-api-token";
import { fail } from "@utils/response";
import type { Env } from "../types/hono";

export const fileApiAuth = createMiddleware<{
  Bindings: Env;
  Variables: { fileApiScopes: FileApiScope[] };
}>(async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const token = c.req
    .header("Authorization")
    ?.match(/^Bearer[ \t]+(ohf_[a-f0-9]{64})$/i)?.[1];
  const record = token ? await getFileApiToken(c.env) : null;
  if (
    !token ||
    !record ||
    (record.expiresAt !== undefined && record.expiresAt <= Date.now()) ||
    (await hashFileApiToken(token)) !== record.hash
  ) {
    c.header("WWW-Authenticate", 'Bearer realm="OtterHub File API"');
    return fail(c, "Invalid or expired API token", 401);
  }
  c.set("fileApiScopes", record.scopes);
  await next();
});

export const requireFileApiScope = (scope: FileApiScope) =>
  createMiddleware<{
    Bindings: Env;
    Variables: { fileApiScopes: FileApiScope[] };
  }>(async (c, next) => {
    if (!c.get("fileApiScopes")?.includes(scope)) {
      return fail(c, `Required scope: ${scope}`, 403);
    }
    await next();
  });
