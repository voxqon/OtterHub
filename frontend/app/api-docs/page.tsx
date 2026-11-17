"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { ApiPageShell } from "@/components/api/ApiPageShell";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api/config";
import { t, useLocale } from "@/lib/i18n";

const subscribeToBase = () => () => {};
const getBase = () => API_URL;
const getServerBase = () => "https://your-otterhub.example";

function Code({ children }: { children: string }) {
  return (
    <div className="relative min-w-0">
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-2 top-2 h-7 w-7 bg-muted"
        title={t("复制")}
        aria-label={t("复制")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(children);
            toast.success(t("已复制"));
          } catch {
            toast.error(t("复制失败"));
          }
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <pre className="max-w-full overflow-x-auto rounded-xl border bg-muted/40 p-4 pr-12 text-xs leading-6">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export default function ApiDocsPage() {
  useLocale();
  const base = useSyncExternalStore(subscribeToBase, getBase, getServerBase);
  const endpoints = [
    ["POST", "/files", "files:write", t("上传单个文件，最大 20 MiB")],
    ["GET", "/files", "files:read", t("分页读取文件列表")],
    ["GET", "/files/{key}", "files:read", t("读取文件元数据")],
    ["GET", "/files/{key}/content", "files:read", t("下载文件，支持 Range")],
    ["PATCH", "/files/{key}", "files:write", t("修改名称、标签、描述和收藏")],
    [
      "DELETE",
      "/files/{key}",
      "files:delete",
      t("移入回收站；permanent=true 永久删除"),
    ],
    ["POST", "/upload/chunk/init", "files:write", t("初始化分段上传")],
    ["POST", "/upload/chunk", "files:write", t("上传并确认一个分片")],
    ["GET", "/upload/chunk/progress", "files:write", t("获取进度和续传凭据")],
    ["POST", "/upload/chunk/complete", "files:write", t("提交凭据并完成上传")],
  ];
  const sections = [
    ["start", t("认证与开始")],
    ["files", t("文件增删改查")],
    ["chunks", t("分段上传与续传")],
    ["errors", t("响应与错误")],
  ];
  return (
    <ApiPageShell active="docs">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <aside>
          <nav
            aria-label={t("文档目录")}
            className="flex flex-wrap gap-2 lg:sticky lg:top-6 lg:flex-col"
          >
            {sections.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 space-y-10 pb-12 text-sm leading-7">
          <div>
            <p className="mb-2 text-xs font-medium text-primary">
              OtterHub · API v1
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("API 调用说明")}
            </h1>
            <p className="mt-3 text-muted-foreground">
              {t(
                "通过独立密钥管理文件，支持最大 1000 MiB 分段上传和断点续传。"
              )}
            </p>
          </div>
          <section id="start" className="scroll-mt-6 space-y-4">
            <h2 className="text-xl font-semibold">{t("认证与开始")}</h2>
            <p>
              {t(
                "先在密钥管理页生成密钥并选择读取、写入或删除权限。每个请求携带 Authorization: Bearer <TOKEN>，无需管理员 Cookie。"
              )}
            </p>
            <Link
              className="inline-block text-primary underline"
              href="/api-keys/"
            >
              {t("前往密钥管理")}
            </Link>
            <Code>{`BASE='${base}'\nTOKEN='ohf_...'\n\ncurl "$BASE/api/v1/files?limit=50" \\\n  -H "Authorization: Bearer $TOKEN"`}</Code>
            <p className="text-muted-foreground">
              {t(
                "示例中的 BASE 是后端域名，TOKEN 替换为密钥；curl 示例使用 Bash。密钥获取、刷新状态、重置和撤销均在密钥管理页完成。"
              )}
            </p>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-xs">
                <caption className="border-b bg-muted/30 px-4 py-3 text-left font-medium">
                  {t("所有路径均以 /api/v1 开头")}
                </caption>
                <thead className="border-b text-muted-foreground">
                  <tr>
                    {[t("方法"), t("路径"), t("所需权限"), t("说明")].map(
                      (label) => (
                        <th
                          key={label}
                          className="whitespace-nowrap px-4 py-2 font-medium"
                        >
                          {label}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map(([method, path, scope, desc]) => (
                    <tr
                      key={`${method}${path}`}
                      className="border-b last:border-0"
                    >
                      <td className="px-4 py-3 font-mono font-medium">
                        {method}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono">
                        {path}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono">
                        {scope}
                      </td>
                      <td className="min-w-40 px-4 py-3">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section id="files" className="scroll-mt-6 space-y-4">
            <h2 className="text-xl font-semibold">{t("文件增删改查")}</h2>
            <h3 className="font-semibold">{t("上传与查询")}</h3>
            <p>
              {t(
                "普通上传使用 multipart/form-data，file 必填，tags 是 JSON 字符串，可选 private、nsfw；desc 最多 300 字符。文件名最多 128 字符，不含路径分隔符。单文件最大 20 MiB，较大文件使用分段上传。"
              )}
            </p>
            <Code>{`curl "$BASE/api/v1/files" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -F 'file=@example.txt' -F 'tags=["private"]' -F 'desc=API upload'\n\n# URL-encode the returned data.key, for example doc:example.txt\nKEY='doc%3Aexample.txt'\ncurl "$BASE/api/v1/files/$KEY" -H "Authorization: Bearer $TOKEN"\ncurl "$BASE/api/v1/files/$KEY/content" -H "Authorization: Bearer $TOKEN" -o downloaded.txt\ncurl "$BASE/api/v1/files?limit=50&fileType=doc" -H "Authorization: Bearer $TOKEN"`}</Code>
            <p className="text-muted-foreground">
              {t(
                "列表使用 limit（1–1000，默认 50）、cursor 和 fileType（img、audio、video、doc）。将 data.cursor 编码后传入下一页，直到 data.list_complete 为 true；即使文件数组为空也可能还有下一页。"
              )}
            </p>
            <h3 className="font-semibold">{t("修改与删除")}</h3>
            <p>
              {t(
                "PATCH 至少提供 fileName、tags、desc、liked 中的一项；tags 整体替换，[] 清空标签，不支持覆盖文件内容。DELETE 默认移入回收站，可在网页恢复；永久删除直接对现存文件追加 ?permanent=true。"
              )}
            </p>
            <Code>{`curl "$BASE/api/v1/files/$KEY" -X PATCH \\\n  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\\n  -d '{"fileName":"renamed.txt","tags":["private"],"desc":"updated","liked":true}'\n\ncurl "$BASE/api/v1/files/$KEY" -X DELETE -H "Authorization: Bearer $TOKEN"\n# Alternative: permanently delete an active file\ncurl "$BASE/api/v1/files/$KEY?permanent=true" -X DELETE -H "Authorization: Bearer $TOKEN"`}</Code>
          </section>
          <section id="chunks" className="scroll-mt-6 space-y-4">
            <h2 className="text-xl font-semibold">{t("分段上传与续传")}</h2>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="font-semibold">
                {t("最大 1000 MiB（1,048,576,000 字节）")}
              </p>
              <p>
                {t(
                  "每片 20 MiB（20,971,520 字节），最多 50 片；末片必须等于剩余字节。四个分段接口均要求 files:write，进度查询也可能完成文件合并。"
                )}
              </p>
            </div>
            <h3 className="font-semibold">{t("1. 初始化上传")}</h3>
            <p>
              {t(
                "JSON 提供 fileType、fileName、fileSize 和 totalChunks，可选 tags、desc。totalChunks 必须等于 ceil(fileSize / 20971520)。响应 data 为原始上传 key，请保存以便续传。以下以 20 MiB 加 4 字节的文件为例。"
              )}
            </p>
            <Code>{`curl "$BASE/api/v1/upload/chunk/init" \\\n  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\\n  -d '{"fileType":"doc","fileName":"large.bin","fileSize":20971524,"totalChunks":2,"tags":["private"]}'\n\n# Use the raw key returned in data\nUPLOAD_KEY='doc:chunk_....bin'`}</Code>
            <h3 className="font-semibold">{t("2. 逐片上传并保存 receipt")}</h3>
            <p>
              {t(
                "multipart 字段为 key、chunkIndex（从 0 开始）、chunkFile。接口等待存储确认后返回 data.receipt；保留所有凭据用于完成提交。同一 key 和索引可重试，已确认的分片会被复用。"
              )}
            </p>
            <Code>{`split -b 20971520 -d large.bin part-\ncurl "$BASE/api/v1/upload/chunk" -H "Authorization: Bearer $TOKEN" \\\n  -F "key=$UPLOAD_KEY" -F 'chunkIndex=0' -F 'chunkFile=@part-00' -F 'returnReceipt=true'\ncurl "$BASE/api/v1/upload/chunk" -H "Authorization: Bearer $TOKEN" \\\n  -F "key=$UPLOAD_KEY" -F 'chunkIndex=1' -F 'chunkFile=@part-01' -F 'returnReceipt=true'`}</Code>
            <h3 className="font-semibold">{t("3. 断点续传")}</h3>
            <p>
              {t(
                "用原始 key 查询进度，data.uploadedIndices 表示已存分片，data.receipts 可用于完成提交；仅补传缺失索引。临时上传和凭据有效期为 1 小时，请在初始化后 1 小时内完成。KV 同步有延迟，刚上传的分片可能暂时未出现在进度中。"
              )}
            </p>
            <Code>{`curl --get "$BASE/api/v1/upload/chunk/progress" \\\n  -H "Authorization: Bearer $TOKEN" --data-urlencode "key=$UPLOAD_KEY"`}</Code>
            <h3 className="font-semibold">{t("4. 提交完成")}</h3>
            <p>
              {t(
                "将同一文件的全部 receipt 放入 receipts 数组提交。成功返回 data 文件元数据；缺片、大小不符、凭据过期或混用其他文件的凭据会被拒绝。完成后通过 /files/{key}/content 下载，也支持跨分片 Range。"
              )}
            </p>
            <Code>{`curl "$BASE/api/v1/upload/chunk/complete" \\\n  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\\n  -d '{"key":"doc:chunk_....bin","receipts":["<receipt-0>","<receipt-1>"]}'`}</Code>
            <div className="space-y-3 rounded-xl border p-4">
              <h3 className="font-semibold">{t("可运行的分段上传示例")}</h3>
              <p>
                {t(
                  "下载 Node.js 20.9+ 示例，按 20 MiB 读取文件并保存本地续传状态。中断后对同一文件再次运行即可续传，状态文件不保存 API 密钥。"
                )}
              </p>
              <a
                className="inline-flex items-center gap-2 text-primary underline"
                href="/examples/file-api-upload.mjs"
                download
              >
                <Download className="h-4 w-4" />
                file-api-upload.mjs
              </a>
              <Code>{`# Bash\nBASE_URL='${base}' FILE_API_TOKEN='ohf_...' node file-api-upload.mjs ./large.bin\n\n# PowerShell\n$env:BASE_URL='${base}'\n$env:FILE_API_TOKEN='ohf_...'\nnode ./file-api-upload.mjs ./large.bin`}</Code>
            </div>
          </section>
          <section id="errors" className="scroll-mt-6 space-y-4">
            <h2 className="text-xl font-semibold">{t("响应与错误")}</h2>
            <p>
              {t(
                "普通上传成功为 HTTP 201，其余 JSON 成功响应为 HTTP 200。下载直接返回文件字节，Range 返回 206，不可满足的范围返回 416。"
              )}
            </p>
            <Code>{`{"success":true,"data":{"key":"doc:example.txt","metadata":{"fileName":"example.txt","fileSize":4,"uploadedAt":1794787200000,"liked":false,"tags":["private"]}}}\n\n{"success":false,"data":null,"message":"Required scope: files:write"}`}</Code>
            <ul className="space-y-1 text-muted-foreground">
              <li>{t("400：参数、文件大小与片数、分片长度或凭据无效。")}</li>
              <li>
                {t("401：密钥缺失、无效、过期或已撤销；403：缺少所需权限。")}
              </li>
              <li>
                {t(
                  "404：文件或上传不存在；413：请求体或分片过大；415：请求格式错误。"
                )}
              </li>
              <li>
                {t(
                  "500：服务配置或存储异常；503：分片存储或完成失败，可保留 key 和凭据稍后重试。"
                )}
              </li>
            </ul>
            <p className="text-muted-foreground">
              {t(
                "读取权限可访问私有文件。请在可信服务端保存密钥并使用 HTTPS；API 密钥不能访问管理员设置。普通上传和初始化重试可能创建新文件，分段续传请始终复用同一 key。"
              )}
            </p>
          </section>
        </main>
      </div>
    </ApiPageShell>
  );
}
