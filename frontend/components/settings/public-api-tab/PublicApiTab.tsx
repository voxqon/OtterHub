"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API_URL, unwrap } from "@/lib/api/config";

const example = `// Node.js 20+; set OTTER_URL and OTTER_SECRET in the environment
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash, createHmac } from "node:crypto";

const path = process.argv[2];
const body = await readFile(path);
const timestamp = String(Math.floor(Date.now() / 1000));
const filename = encodeURIComponent(basename(path));
const digest = createHash("sha256").update(body).digest("hex");
const message = ["POST", "/public/upload", timestamp, filename, digest].join("\\n");
const signature = createHmac("sha256", process.env.OTTER_SECRET)
  .update(message).digest("hex");
const response = await fetch(new URL("/public/upload", process.env.OTTER_URL), {
  method: "POST",
  headers: {
    "Content-Type": "application/octet-stream",
    "X-Otter-Timestamp": timestamp,
    "X-Otter-Filename": filename,
    "X-Otter-Content-SHA256": digest,
    "X-Otter-Signature": signature,
  },
  body,
});
console.log(response.status, await response.json());`;

async function request<T>(path: string, method = "GET"): Promise<T> {
  return unwrap<T>(fetch(`${API_URL}/settings/public-api${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
  }));
}

export function PublicApiTab() {
  const [configured, setConfigured] = useState(false);
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<{ configured: boolean }>("")
      .then((data) => setConfigured(data.configured))
      .catch(() => toast.error("获取公共接口配置失败"))
      .finally(() => setLoading(false));
  }, []);

  const rotate = async () => {
    if (configured && !window.confirm("生成新密钥后，旧密钥将失效。继续吗？")) return;
    setBusy(true);
    try {
      const data = await request<{ secret: string }>("/rotate", "POST");
      setSecret(data.secret);
      setConfigured(true);
      toast.success("密钥已生成");
    } catch {
      toast.error("生成密钥失败");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm("停用公共接口并撤销当前密钥？")) return;
    setBusy(true);
    try {
      await request("", "DELETE");
      setConfigured(false);
      setSecret("");
      toast.success("公共接口已停用");
    } catch {
      toast.error("停用失败");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 pb-6">
        <div>
          <h2 className="text-lg font-semibold">公共接口</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "正在读取配置..." : configured ? "已启用签名上传" : "尚未配置密钥"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={rotate} disabled={loading || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            {configured ? "轮换密钥" : "生成密钥"}
          </Button>
          {configured && (
            <Button size="sm" variant="outline" onClick={revoke} disabled={busy}>
              <Trash2 className="mr-2 h-4 w-4" />停用接口
            </Button>
          )}
        </div>
        {secret && (
          <div className="space-y-2 border-l-2 border-amber-500 pl-4">
            <p className="text-sm font-medium">密钥仅显示一次，请立即保存到安全位置。</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all text-sm">{secret}</code>
              <Button size="icon" variant="ghost" onClick={() => copy(secret)} title="复制密钥" aria-label="复制密钥">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold">接口对接</h3>
          <p><code>POST {API_URL || "(当前站点)"}/public/upload</code></p>
          <p className="text-muted-foreground">请求体为文件原始字节，最大 20 MiB。签名有效期为前后 5 分钟；同一签名在有效期内可重复使用。仅在可信服务端保存密钥并使用 HTTPS。</p>
          <p className="text-muted-foreground">新文件默认公开；轮换或停用可能因存储同步延迟而不会立即在所有地区生效。</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Node.js 示例</h3>
            <Button size="icon" variant="ghost" onClick={() => copy(example)} title="复制示例" aria-label="复制示例">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 text-xs leading-5"><code>{example}</code></pre>
        </div>
      </div>
    </div>
  );
}
