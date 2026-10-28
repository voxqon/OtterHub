import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'Range', 'X-Otter-Timestamp', 'X-Otter-Filename', 'X-Otter-Content-SHA256', 'X-Otter-Signature'],
  exposeHeaders: ['Content-Length', 'Content-Range'],
  maxAge: 86400,
  credentials: true,
});
