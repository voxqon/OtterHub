import { Hono } from "hono";
import { getTgFilePath, buildTgFileUrl } from "@utils/db-adapter/tg-tools";
import type { Env } from "../../types/hono";
import { fail } from "@utils/response";
import { getFromCache, putToCache } from "@utils/cache";

export const thumbRoutes = new Hono<{ Bindings: Env }>();

thumbRoutes.get("/:key/thumb", async (c) => {
  const thumbFileId = c.req.param("key");
  const botToken = c.env.TG_BOT_TOKEN;

  if (!botToken) {
    return fail(c, "TG_BOT_TOKEN not configured", 500);
  }

  try {
    const cached = await getFromCache(c.req.raw);
    if (cached) return cached;
    let filePath = await getTgFilePath(
      thumbFileId,
      botToken,
      false,
      c.env.TG_API_BASE_URL
    );
    if (!filePath) {
      return fail(c, "Thumbnail not found", 404);
    }

    let response = await fetch(
      buildTgFileUrl(botToken, filePath, c.env.TG_API_BASE_URL)
    );
    if (response.status === 401 || response.status === 404) {
      await response.body?.cancel();
      filePath = await getTgFilePath(
        thumbFileId,
        botToken,
        true,
        c.env.TG_API_BASE_URL
      );
      if (!filePath) return fail(c, "Thumbnail not found", 404);
      response = await fetch(
        buildTgFileUrl(botToken, filePath, c.env.TG_API_BASE_URL)
      );
    }

    if (!response.ok) {
      return fail(c, "Failed to fetch thumbnail", 502);
    }

    const result = new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
    c.executionCtx.waitUntil(putToCache(c.req.raw, result.clone(), "thumb"));
    return result;
  } catch (error: any) {
    console.error("Fetch thumbnail error:", error);
    return fail(c, error.message);
  }
});
