"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  FILE_API_SCOPES,
  type FileApiScope,
  type FileApiTokenStatus,
} from "@shared/types";
import { Button } from "@/components/ui/button";
import { API_URL, unwrap } from "@/lib/api/config";
import { t, useLocale } from "@/lib/i18n";

async function request<T>(
  path = "",
  method = "GET",
  options?: unknown
): Promise<T> {
  return unwrap<T>(
    fetch(`${API_URL}/settings/file-api${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      ...(options === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options),
          }),
    })
  );
}

export function FileApiPanel() {
  const locale = useLocale();
  const [status, setStatus] = useState<FileApiTokenStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scopes, setScopes] = useState<FileApiScope[]>([
    "files:read",
    "files:write",
  ]);
  const [expiry, setExpiry] = useState("90");

  const refresh = useCallback(async () => {
    setBusy(true);
    setToken("");
    setVisible(false);
    try {
      const data = await request<FileApiTokenStatus>();
      setStatus(data);
      setFailed(false);
      if (data.configured) setScopes(data.scopes);
    } catch {
      setFailed(true);
      setStatus(null);
      toast.error(t("获取文件 API 配置失败"));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reveal = async () => {
    setBusy(true);
    setToken("");
    try {
      const data = await request<{ token: string; status: FileApiTokenStatus }>(
        "/reveal",
        "POST"
      );
      setToken(data.token);
      setVisible(true);
      setStatus(data.status);
    } catch {
      toast.error(
        t("获取密钥失败，请刷新状态；旧密钥或加密配置变化后需重置密钥。")
      );
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (
      status?.configured &&
      !window.confirm(t("生成新令牌后，旧令牌将失效。继续吗？"))
    )
      return;
    setBusy(true);
    setToken("");
    try {
      const data = await request<{ token: string; status: FileApiTokenStatus }>(
        "/rotate",
        "POST",
        {
          scopes,
          expiresInDays: expiry === "never" ? null : Number(expiry),
        }
      );
      setToken(data.token);
      setVisible(true);
      setStatus(data.status);
      toast.success(t("API 令牌已生成"));
    } catch {
      toast.error(t("生成 API 令牌失败"));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm(t("停用文件 API 并撤销当前令牌？"))) return;
    setBusy(true);
    setToken("");
    try {
      setStatus(await request<FileApiTokenStatus>("", "DELETE"));
      toast.success(t("文件 API 已停用"));
    } catch {
      toast.error(t("停用失败"));
    } finally {
      setBusy(false);
    }
  };

  const scopeLabels: Record<FileApiScope, string> = {
    "files:read": t("读取列表、元数据和文件内容"),
    "files:write": t("上传文件、修改名称和标签"),
    "files:delete": t("移入回收站和永久删除"),
  };

  return (
    <section className="space-y-5 border-b pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("文件管理 API")}</h2>
          <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
            {failed
              ? t("获取文件 API 配置失败")
              : status === null
                ? t("正在读取配置...")
                : status.enabled
                  ? t("文件 API 已启用")
                  : status.configured
                    ? t("API 令牌已过期")
                    : t("尚未配置令牌")}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t("刷新状态")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          "使用独立 Bearer 密钥授权文件增删改查。管理员可获取已有密钥，或重置生成新密钥；刷新状态不会更换密钥。"
        )}
      </p>
      {failed && (
        <Link
          className="inline-block text-sm text-primary underline"
          href="/login/?redirect=%2Fapi-keys%2F"
        >
          {t("登录管理员账号")}
        </Link>
      )}
      {status?.configured && (
        <div className="space-y-1 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p className="break-all">
            {t("当前权限：{0}", status.scopes.join(", "))}
          </p>
          <p>{t("令牌尾号：{0}", status.fingerprint)}</p>
          <p>
            {status.expiresAt
              ? t(
                  "到期时间：{0}",
                  new Date(status.expiresAt).toLocaleString(locale)
                )
              : t("永不过期")}
          </p>
          {!status.recoverable && (
            <p className="text-amber-600 dark:text-amber-400">
              {t("此密钥仅保存了摘要，请重置一次以启用密钥获取功能。")}
            </p>
          )}
        </div>
      )}
      <fieldset className="space-y-3" disabled={busy || status === null}>
        <legend className="mb-2 text-sm font-medium">{t("新令牌权限")}</legend>
        {FILE_API_SCOPES.map((scope) => (
          <label
            key={scope}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={(event) =>
                setScopes((current) =>
                  event.target.checked
                    ? [...current, scope]
                    : current.filter((item) => item !== scope)
                )
              }
            />
            {scopeLabels[scope]}{" "}
            <code className="text-xs text-muted-foreground">{scope}</code>
          </label>
        ))}
        <label className="flex items-center gap-3 text-sm">
          {t("令牌有效期")}
          <select
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            className="rounded-md border bg-background px-3 py-2"
          >
            {[7, 30, 90, 365].map((days) => (
              <option key={days} value={days}>
                {t("{0} 天", days)}
              </option>
            ))}
            <option value="never">{t("永不过期")}</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {t("权限和有效期在生成或重置密钥后生效。")}
        </p>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={rotate}
          disabled={busy || status === null || scopes.length === 0}
        >
          <KeyRound className="mr-2 h-4 w-4" />
          {status?.configured ? t("重置密钥") : t("生成 API 令牌")}
        </Button>
        {status?.configured && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={reveal}
              disabled={busy || !status.recoverable}
            >
              <Eye className="mr-2 h-4 w-4" />
              {t("获取密钥")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={revoke}
              disabled={busy}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("停用文件 API")}
            </Button>
          </>
        )}
      </div>
      {token && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <label htmlFor="file-api-token" className="text-sm font-medium">
            {t("当前 API 密钥")}
          </label>
          <div className="flex items-center gap-1">
            <input
              id="file-api-token"
              type={visible ? "text" : "password"}
              value={token}
              readOnly
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-xs"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setVisible((value) => !value)}
              title={visible ? t("隐藏密钥") : t("显示密钥")}
              aria-label={visible ? t("隐藏密钥") : t("显示密钥")}
            >
              {visible ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token);
                  toast.success(t("已复制"));
                } catch {
                  toast.error(t("复制失败"));
                }
              }}
              title={t("复制令牌")}
              aria-label={t("复制令牌")}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs leading-6 text-muted-foreground">
        {t(
          "密钥在服务端加密保存，只有管理员可以获取；认证使用 SHA-256 摘要。请通过 HTTPS 调用并妥善保存密钥，读取权限包含私有文件。重置和撤销受 KV 同步延迟影响。"
        )}
      </p>
      <div className="flex flex-wrap gap-4 text-sm text-primary">
        <Link
          href="/api-docs/"
          className="inline-flex items-center gap-2 underline"
        >
          <BookOpen className="h-4 w-4" />
          {t("API 调用说明")}
        </Link>
        <Link
          href="/api-keys/"
          className="inline-flex items-center gap-2 underline"
        >
          <KeyRound className="h-4 w-4" />
          {t("API 密钥管理")}
        </Link>
      </div>
    </section>
  );
}
