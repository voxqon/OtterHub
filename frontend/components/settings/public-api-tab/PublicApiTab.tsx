"use client";
import { t, useLocale } from "@/lib/i18n";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API_URL, unwrap } from "@/lib/api/config";

const signatureText = [
  "POST",
  "/public/upload",
  "<X-Otter-Timestamp>",
  "<X-Otter-Filename>",
  "<X-Otter-Content-SHA256>",
].join("\n");

async function request<T>(path: string, method = "GET"): Promise<T> {
  return unwrap<T>(
    fetch(`${API_URL}/settings/public-api${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
    })
  );
}

export function PublicApiTab() {
  useLocale();
  const [configured, setConfigured] = useState(false);
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [endpoint, setEndpoint] = useState("/public/upload");

  useEffect(() => {
    setEndpoint(`${API_URL}/public/upload`);
    request<{ configured: boolean }>("")
      .then((data) => setConfigured(data.configured))
      .catch(() => toast.error(t("获取公共接口配置失败")))
      .finally(() => setLoading(false));
  }, []);

  const rotate = async () => {
    if (
      configured &&
      !window.confirm(t("生成新密钥后，旧密钥将失效。继续吗？"))
    )
      return;
    setBusy(true);
    try {
      const data = await request<{ secret: string }>("/rotate", "POST");
      setSecret(data.secret);
      setConfigured(true);
      toast.success(t("密钥已生成"));
    } catch {
      toast.error(t("生成密钥失败"));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm(t("停用公共接口并撤销当前密钥？"))) return;
    setBusy(true);
    try {
      await request("", "DELETE");
      setConfigured(false);
      setSecret("");
      toast.success(t("公共接口已停用"));
    } catch {
      toast.error(t("停用失败"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("已复制"));
    } catch {
      toast.error(t("复制失败"));
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto min-w-0 max-w-3xl space-y-6 pb-6">
        <div>
          <h2 className="text-lg font-semibold">{t("公共接口")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? t("正在读取配置...")
              : configured
                ? t("已启用签名上传")
                : t("尚未配置密钥")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={rotate} disabled={loading || busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" />
            )}
            {configured ? t("轮换密钥") : t("生成密钥")}
          </Button>
          {configured && (
            <Button
              size="sm"
              variant="outline"
              onClick={revoke}
              disabled={busy}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("停用接口")}
            </Button>
          )}
        </div>
        {secret && (
          <div className="space-y-2 border-l-2 border-amber-500 pl-4">
            <p className="text-sm font-medium">
              {t("密钥仅显示一次，请立即保存到安全位置。")}
            </p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all text-sm">{secret}</code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copy(secret)}
                title={t("复制密钥")}
                aria-label={t("复制密钥")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold">{t("接口对接")}</h3>
          <p className="break-all font-mono">POST {endpoint}</p>
          <p className="text-muted-foreground">
            {t(
              "使用 HMAC-SHA256 签名上传单个文件，无需管理员 Cookie。此密钥仅允许上传，不能读取文件列表或调用管理接口。"
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "请求体为文件原始字节，最大 20 MiB（20,971,520 字节），不使用 JSON 或 multipart/form-data，不支持分片、标签和自定义描述。"
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "新文件默认公开；轮换或停用可能因存储同步延迟而不会立即在所有地区生效。"
            )}
          </p>
        </div>
        <section className="space-y-3 border-t pt-4 text-sm">
          <h3 className="font-semibold">{t("请求头")}</h3>
          <dl className="space-y-4">
            <div>
              <dt className="break-all font-mono">Content-Type</dt>
              <dd className="mt-1 text-muted-foreground">
                {t(
                  "建议使用 application/octet-stream；文件类型根据文件名扩展名判断。"
                )}
              </dd>
            </div>
            <div>
              <dt className="break-all font-mono">
                X-Otter-Timestamp{" "}
                <span className="font-sans text-muted-foreground">
                  {t("（必填）")}
                </span>
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {t(
                  "10 位 Unix 时间戳，单位为秒，与服务器时间相差不得超过 300 秒。"
                )}
              </dd>
            </div>
            <div>
              <dt className="break-all font-mono">
                X-Otter-Filename{" "}
                <span className="font-sans text-muted-foreground">
                  {t("（必填）")}
                </span>
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {t(
                  "UTF-8 文件名的 URL 百分号编码。解码后为 1–128 个字符，不得包含 /、\\ 或控制字符。例如：测试.txt → %E6%B5%8B%E8%AF%95.txt。"
                )}
              </dd>
            </div>
            <div>
              <dt className="break-all font-mono">
                X-Otter-Content-SHA256{" "}
                <span className="font-sans text-muted-foreground">
                  {t("（必填）")}
                </span>
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {t(
                  "对请求体的原始字节计算 SHA-256，结果为 64 位小写十六进制字符串；服务端会校验内容一致性。"
                )}
              </dd>
            </div>
            <div>
              <dt className="break-all font-mono">
                X-Otter-Signature{" "}
                <span className="font-sans text-muted-foreground">
                  {t("（必填）")}
                </span>
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {t(
                  "使用密钥字符串的 UTF-8 字节作为 HMAC 密钥，对下方签名文本计算 HMAC-SHA256，结果为 64 位小写十六进制。不要将密钥按十六进制解码。"
                )}
              </dd>
            </div>
          </dl>
        </section>
        <section className="space-y-3 border-t pt-4 text-sm">
          <h3 className="font-semibold">{t("签名规则")}</h3>
          <p className="text-muted-foreground">
            {t(
              "以下五行以 LF 换行符（\\n）连接，末尾不加换行。文件名必须使用请求头中的编码原文；路径固定为 /public/upload，不包含域名或查询参数。"
            )}
          </p>
          <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-4 text-xs leading-5">
            <code>{signatureText}</code>
          </pre>
          <p className="text-muted-foreground">
            {t(
              "密钥仅保存在可信服务端，并使用 HTTPS。签名有效期为前后 5 分钟，同一签名在有效期内可重复使用。"
            )}
          </p>
        </section>
        <section className="space-y-3 border-t pt-4 text-sm">
          <h3 className="font-semibold">{t("响应")}</h3>
          <p className="text-muted-foreground">
            {t(
              "成功返回 HTTP 200。data.key 是文件标识，可用于 /file/{key} 访问路径；图片可能经过 Telegram 压缩。"
            )}
          </p>
          <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-4 text-xs leading-5">
            <code>{'{"success":true,"data":{"key":"doc:example.txt"}}'}</code>
          </pre>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">{t("状态码")}</th>
                  <th className="py-2">{t("含义")}</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b">
                  <td className="py-2 pr-4 font-mono">400</td>
                  <td className="py-2">
                    {t("文件名无效、缺少请求体，或文件内容与摘要不匹配。")}
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4 font-mono">401</td>
                  <td className="py-2">
                    {t("未配置密钥、签名无效或过期，或摘要/签名格式错误。")}
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4 font-mono">413</td>
                  <td className="py-2">
                    {t(
                      "声明或实际接收的文件大小超过 20 MiB，或 Content-Length 格式无效。"
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">500</td>
                  <td className="py-2">{t("读取文件或存储失败。")}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground">
            {t(
              "错误响应为 success: false，并包含 message。接口没有幂等去重；超时或失败后重试可能产生重复文件。"
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
