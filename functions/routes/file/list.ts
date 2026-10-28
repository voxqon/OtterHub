import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { FileType } from "@shared/types";
import type { Env } from "../../types/hono";
import { fail } from "@utils/response";
import { authMiddleware } from "middleware/auth";

export const listRoutes = new Hono<{ Bindings: Env }>();

listRoutes.get(
  "/list",
  authMiddleware,
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().int().positive().default(50),
      cursor: z.string().optional(),
      fileType: z.enum(FileType).optional(),
    })
  ),
  async (c) => {
    const { limit, cursor, fileType } = c.req.valid("query");
    const kv = c.env.oh_file_url;

    if (limit < 1) {
      return fail(c, "Invalid limit parameter", 400);
    }

    const options = {
      prefix: fileType ? `${fileType}:` : undefined,
      limit: Math.min(limit, 1000),
      cursor,
    };

    try {
      const result = await kv.list(options);
      c.header("Cache-Control", "private, no-store");
      return c.json({
        success: true,
        data: {
          keys: result.keys.filter((item: { name: string }) =>
            /^(img|audio|video|doc|trash):/.test(item.name)
          ),
          list_complete: result.list_complete,
          cursor: result.cursor,
        },
      });
    } catch (err) {
      console.error("[KV:list] error:", err);
      return fail(c, "Failed to fetch files");
    }
  }
);
