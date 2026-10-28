import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { CF } from 'types';
import { GeneralSettings } from '@shared/types';

import { ok, fail } from '@utils/response';
import { kvGetJSON } from '@utils/kv';
import { Env } from 'types/hono';
import { createMiddleware } from 'hono/factory';

function createSettingsRoutes<T>(
  app: Hono<{ Bindings: Env }>,
  path: string,
  key: string,
  options?: {
    getMessage?: string;
    postMessage?: string;
  }
) {
  const getMsg = options?.getMessage ?? "获取配置失败";
  const postMsg = options?.postMessage ?? "配置已更新";

  app.get(path, async c => {
    try {
      const kv = c.env.oh_file_url;
      const data = await kvGetJSON<T>(kv, key, {} as T);
      return ok(c, data);
    } catch (e: any) {
      return fail(c, `${getMsg}: ${e.message}`, 500);
    }
  });

  app.post(path, async c => {
    try {
      const kv = c.env.oh_file_url;
      const body = await c.req.json<T>();
      await kv.put(key, JSON.stringify(body));
      return ok(c, body, postMsg);
    } catch (e: any) {
      return fail(c, `${postMsg}失败: ${e.message}`, 500);
    }
  });
}

export const settingsRoutes = new Hono<{ Bindings: Env }>();

settingsRoutes.use('*', authMiddleware);

/* ========= Settings ========= */

const PUBLIC_API_KEY = 'oh_public_api_secret';

const protectPublicApiSettings = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const origin = c.req.header('Origin');
  if (origin) {
    const requestUrl = new URL(c.req.url);
    let allowed = false;
    try {
      const originUrl = new URL(origin);
      allowed = originUrl.origin === requestUrl.origin ||
        (requestUrl.hostname === 'localhost' && originUrl.hostname === 'localhost' &&
          originUrl.protocol === requestUrl.protocol);
    } catch {
      allowed = false;
    }
    if (!allowed) return fail(c, 'Cross-origin access denied', 403);
  }
  await next();
});
settingsRoutes.use('/public-api', protectPublicApiSettings);
settingsRoutes.use('/public-api/*', protectPublicApiSettings);

settingsRoutes.get('/public-api', async c => {
  const secret = await c.env.oh_file_url.get(PUBLIC_API_KEY);
  c.header('Cache-Control', 'no-store');
  return ok(c, { configured: Boolean(secret) });
});

settingsRoutes.post('/public-api/rotate', async c => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  await c.env.oh_file_url.put(PUBLIC_API_KEY, secret);
  c.header('Cache-Control', 'no-store');
  return ok(c, { secret });
});

settingsRoutes.delete('/public-api', async c => {
  await c.env.oh_file_url.delete(PUBLIC_API_KEY);
  c.header('Cache-Control', 'no-store');
  return ok(c, { configured: false });
});

createSettingsRoutes<GeneralSettings>(
  settingsRoutes,
  '/general',
  CF.SETTINGS_KEY,
  {
    getMessage: '获取常规设置失败',
    postMessage: '常规设置已更新',
  }
);

createSettingsRoutes(
  settingsRoutes,
  '/wallpaper',
  CF.WALLPAPER_CONFIG_KEY,
  {
    getMessage: '获取壁纸配置失败',
    postMessage: '壁纸配置已更新',
  }
);
