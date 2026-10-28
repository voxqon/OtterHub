import { t } from "@/lib/i18n/core";
import { ApiResponse } from "@shared/types";

export const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");

/**
 * 统一处理后端 ok / fail 响应
 * 支持传入 Response 对象或 Promise<Response>
 */
export async function unwrap<T>(
  resOrPromise: Response | Promise<Response>
): Promise<T> {
  const res = await resOrPromise;

  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try {
      const body = JSON.parse(raw) as ApiResponse;
      message = body.message || raw;
    } catch {
      // Non-JSON errors can come from an upstream proxy.
    }
    if (message.includes("Telegram message reference is missing")) {
      message = t(
        "旧文件没有保存 Telegram 消息 ID，无法自动删除聊天消息，请在 Telegram 中手动清理。"
      );
    } else if (message.includes("Telegram message deletion failed")) {
      const reason =
        message.split("Telegram message deletion failed: ")[1] || "";
      message = /message can't be deleted/i.test(reason)
        ? t(
            "Telegram 不允许删除此消息，请检查消息是否超过 48 小时，以及机器人是否拥有删除权限。"
          )
        : t("Telegram 消息删除失败：{0}", reason);
    }
    throw new Error(message || t("请求失败"));
  }

  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) {
    throw new Error(body.message || t("请求失败"));
  }

  return body.data as T;
}
