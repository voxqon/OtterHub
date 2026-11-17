# 文件管理 API

网页入口：**首页页脚 → API 调用说明**（`/api-docs/`）与 **API 密钥管理**（`/api-keys/`）。设置 → 公共接口也可管理文件 API 密钥。默认授予读取和写入权限，有效期 90 天，删除权限需单独勾选。也可选择 7、30、365 天或永不过期。目前一个部署维护一个文件管理令牌，重置会替换旧令牌。

密钥页支持刷新状态（不更换密钥）、获取当前密钥、复制、显示/隐藏、重置和停用。选择的权限和有效期在生成或重置后生效。

每次请求携带：

```http
Authorization: Bearer ohf_<生成的令牌>
```

令牌由 32 字节加密随机数生成。认证使用 SHA-256 摘要；为支持管理员再次获取，原令牌使用 AES-256-GCM 加密后保存在 KV，密钥由环境变量 `JWT_SECRET` 派生，每次生成使用独立随机 IV。状态接口不返回原令牌、密文或摘要。旧版仅存摘要的令牌仍可认证，但需重置一次后才能获取原值；更换 `JWT_SECRET` 后也需重置。请在可信服务端保存并通过 HTTPS 调用。令牌不可管理设置、分享或管理员接口。原有 `/public/upload` 的 HMAC 密钥仍仅能上传文件，不会获得文件管理权限。

| 权限           | 允许的操作                                                   |
| -------------- | ------------------------------------------------------------ |
| `files:read`   | 列表、单文件元数据、下载内容；包括私有文件                   |
| `files:write`  | 普通及分段上传、进度与续传、修改文件名、标签、描述和收藏状态 |
| `files:delete` | 移入回收站、永久删除                                         |

令牌不接受 Cookie 认证；管理员环境变量 `API_TOKEN` 仍用于原有管理接口。文件管理令牌在轮换、停用或到期后将被拒绝。KV 为最终一致性存储，轮换/停用可能需要传播时间，不能保证所有地区立即失效。API 响应均使用 `private, no-store`。

机器可读契约见 [OpenAPI](../postman/file-api.openapi.json)。以下示例为 Bash，`BASE` 为部署域名，`TOKEN` 为文件管理令牌；文件 key 作为 URL 路径参数时需进行百分号编码。

```bash
BASE='https://your-otterhub.example'
TOKEN='ohf_...'
```

## 上传

`POST /api/v1/files`，需要 `files:write`。

使用 `multipart/form-data`，单次仅上传一个文件，文件最多 20 MiB（20,971,520 字节）。请求总大小最多 20 MiB + 64 KiB；服务端会校验实际读取字节数。超过 20 MiB 使用下方分段接口，最大 1000 MiB。

| 字段   | 类型              | 说明                                                               |
| ------ | ----------------- | ------------------------------------------------------------------ |
| `file` | 文件，必填        | 文件名 1–128 字符，不含路径分隔符或控制字符                        |
| `tags` | JSON 字符串，可选 | 例如 `["private","nsfw"]`，默认 `[]`，上传时不会继承网页的默认标签 |
| `desc` | 字符串，可选      | 最多 300 字符，默认空字符串                                        |

```bash
curl "$BASE/api/v1/files" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@example.txt' \
  -F 'tags=["private"]' \
  -F 'desc=API 上传示例'
```

成功返回 HTTP 201，`Location` 指向元数据接口：

```json
{
  "success": true,
  "data": {
    "key": "doc:example.txt",
    "metadata": {
      "fileName": "example.txt",
      "fileSize": 12,
      "uploadedAt": 1794787200000,
      "liked": false,
      "tags": ["private"],
      "desc": "API 上传示例"
    }
  }
}
```

图片沿用 Telegram 存储的处理方式，可能被压缩。上传时显式指定 `private` 标签可禁止普通直链访问，拥有读取权限的令牌仍能下载。

## 分段上传和断点续传（最大 1000 MiB）

与网页使用同一分片和确认凭据协议，原网页 `/upload/chunk*` 仍使用管理员认证。文件 API 的四个接口统一要求 `files:write`；进度查询也可能完成上传，因此不接受只有读取权限的令牌。

- 单文件最大 **1000 MiB（1,048,576,000 字节）**，最多 50 片。
- 每个非末片严格为 **20 MiB（20,971,520 字节）**，末片严格等于声明的剩余字节。
- 初始化 JSON 最多 8 KiB；分片 multipart 最多 20 MiB + 64 KiB；完成 JSON 最多 128 KiB，均按实际接收字节限制。
- 临时上传及凭据有效期 1 小时；请在初始化后 1 小时内完成，完成后的文件索引不再过期。

### 1. 初始化

`POST /api/v1/upload/chunk/init`，JSON 字段：

| 字段          | 说明                                             |
| ------------- | ------------------------------------------------ |
| `fileType`    | 必填，`img`、`audio`、`video`、`doc`             |
| `fileName`    | 必填，1–128 字符，不含路径分隔符或控制字符       |
| `fileSize`    | 必填，原文件字节数，1–1,048,576,000              |
| `totalChunks` | 必填，必须等于 `ceil(fileSize / 20971520)`，1–50 |
| `tags`        | 可选，JSON 数组，`private`、`nsfw`，默认 `[]`    |
| `desc`        | 可选，最多 300 字符                              |

```bash
curl "$BASE/api/v1/upload/chunk/init" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fileType":"doc","fileName":"large.bin","fileSize":20971524,"totalChunks":2,"tags":["private"]}'
```

响应示例：`{"success":true,"data":"doc:chunk_....bin"}`。保存 `data` 原始 key，后续请求复用它，避免重新初始化产生新文件。

### 2. 逐片上传

`POST /api/v1/upload/chunk`，multipart 字段 `key`（原始 key）、`chunkIndex`（从 0 开始）、`chunkFile`（该片字节）。可带 `returnReceipt=true` 以兼容网页调用格式；API 始终等待存储确认并返回 receipt，不使用旧版异步模式。

```bash
UPLOAD_KEY='doc:chunk_....bin'
split -b 20971520 -d large.bin part-
curl "$BASE/api/v1/upload/chunk" -H "Authorization: Bearer $TOKEN" \
  -F "key=$UPLOAD_KEY" -F 'chunkIndex=0' -F 'chunkFile=@part-00' -F 'returnReceipt=true'
curl "$BASE/api/v1/upload/chunk" -H "Authorization: Bearer $TOKEN" \
  -F "key=$UPLOAD_KEY" -F 'chunkIndex=1' -F 'chunkFile=@part-01' -F 'returnReceipt=true'
```

成功返回 `{"success":true,"data":{"chunkIndex":0,"receipt":"..."}}`，保存每片 receipt。已确认的同一 key 和索引重试会复用已存分片，不覆盖原内容。KV 无全局锁，跨地区同时重试仍可能造成上游重复上传。

### 3. 查询进度和续传

```bash
curl --get "$BASE/api/v1/upload/chunk/progress" \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "key=$UPLOAD_KEY"
```

响应：`{"success":true,"data":{"uploadedIndices":[0],"uploaded":1,"total":2,"complete":false,"receipts":["..."]}}`。只补传缺失索引，再将已恢复与新返回的全部凭据提交。进度读可能因 KV 传播暂时缺少刚上传的片；保留上传直接返回的凭据可避免依赖立即可见性。集齐分片时进度接口也会完成索引写入，并返回 `complete:true`。

### 4. 完成提交

```bash
curl "$BASE/api/v1/upload/chunk/complete" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"doc:chunk_....bin","receipts":["<receipt-0>","<receipt-1>"]}'
```

服务器校验签名、有效期、文件 key、连续索引和精确长度，成功响应 `data` 为完成后的文件元数据（含 `chunkInfo`，不暴露存储标识），可重复提交。缺片、错误长度、过期/伪造凭据或混用其他文件凭据返回 400。完成后通过 `/api/v1/files/{key}/content` 下载，支持跨分片 Range。

可运行的跨平台 Node.js 20.9+ 示例见 [file-api-upload.mjs](../frontend/public/examples/file-api-upload.mjs)，也可在网页说明页下载。脚本每次读取 20 MiB，状态保存在原文件旁的 `.otterhub-upload.json`；对同一文件重跑可续传，状态不保存 API 密钥。文件或服务器变化时需手动移走旧状态后重新上传；会话过期后也需新建上传。

```powershell
$env:BASE_URL='https://your-otterhub.example'
$env:FILE_API_TOKEN='ohf_...'
node ./file-api-upload.mjs ./large.bin
```

## 查询列表

`GET /api/v1/files`，需要 `files:read`。

| 查询参数   | 说明                                    |
| ---------- | --------------------------------------- |
| `limit`    | 每次扫描的 KV 条目数，1–1000，默认 50   |
| `cursor`   | 上一页返回的游标，作为 URL 查询参数编码 |
| `fileType` | 可选 `img`、`audio`、`video`、`doc`     |

```bash
curl "$BASE/api/v1/files?limit=50&fileType=doc" -H "Authorization: Bearer $TOKEN"
```

响应为 `{"success":true,"data":{"files":[{"key":"...","metadata":{...}}],"list_complete":true,"cursor":null}}`。列表排除设置、密钥、分享和回收站记录，也不返回 Telegram 消息或内部存储标识。过滤内部条目后可能得到空页，应以 `list_complete` 决定是否继续，不能以 `files.length` 判断结束。列表顺序为 KV 的 key 顺序，不提供搜索或按时间排序。未指定 `fileType` 时，`limit` 不是返回文件数的保证。

## 查询单文件及下载

`GET /api/v1/files/{key}` 返回 `{"success":true,"data":{"key":"...","metadata":{...}}}`。

`GET /api/v1/files/{key}/content` 返回文件字节，保留 `Content-Disposition` 文件名；支持 `Range`，有效范围返回 206，不可满足的范围返回 416。两者均需要 `files:read`。

```bash
KEY='doc%3Aexample.txt'
curl "$BASE/api/v1/files/$KEY" -H "Authorization: Bearer $TOKEN"
curl "$BASE/api/v1/files/$KEY/content" -H "Authorization: Bearer $TOKEN" -o downloaded.txt
```

回收站 key、设置 key、分享 key 不属于此 API 的资源范围。

## 修改元数据

`PATCH /api/v1/files/{key}`，需要 `files:write`，请求为 `application/json`，至少提供一个字段。允许修改 `fileName`、`tags`、`desc`、`liked`。`tags` 会整体替换，`[]` 清空标签，`desc: ""` 清空描述；移除 `private` 会使普通直链公开。接口不覆盖文件二进制内容，不允许修改大小、上传时间、分片信息或内部存储字段。

```bash
curl "$BASE/api/v1/files/$KEY" -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fileName":"renamed.txt","tags":["private"],"desc":"更新后的描述","liked":true}'
```

成功返回 HTTP 200 和更新后的文件元数据，文件 key 保持不变。

## 删除

`DELETE /api/v1/files/{key}`，需要 `files:delete`。默认移入现有回收站，可在网页管理界面恢复；`?permanent=true` 永久删除底层文件/Telegram 消息及索引。

```bash
curl "$BASE/api/v1/files/$KEY" -X DELETE -H "Authorization: Bearer $TOKEN"
# 永久删除需直接针对仍存在的文件调用：
curl "$BASE/api/v1/files/$KEY?permanent=true" -X DELETE -H "Authorization: Bearer $TOKEN"
```

成功返回 HTTP 200 和 `{"success":true,"data":{"key":"...","deleted":true,"permanent":false}}`。重复删除已不存在的 key 返回 404。Telegram 永久删除沿用已有权限和消息时限要求，失败时返回 500 并保留索引供重试；旧文件缺少消息 ID 时应在网页查看详细提示并手动处理。

## 令牌管理（管理员）

以下接口要求管理员 Cookie 或管理员 `API_TOKEN`；浏览器请求还需通过现有同源检查。

| 接口                             | 请求和响应                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /settings/file-api`         | 状态：`configured`、`enabled`、`scopes`，已配置时含 `createdAt`、可选 `expiresAt`、`fingerprint`、`recoverable`；不返回密文、摘要或原令牌 |
| `POST /settings/file-api/rotate` | JSON：`{"scopes":["files:read","files:write"],"expiresInDays":90}`；返回 `{"token":"ohf_...","status":{...}}`                             |
| `POST /settings/file-api/reveal` | 获取当前密钥，返回 `{"token":"ohf_...","status":{...}}`；未配置返回 404，旧令牌或无法解密时返回 409，需重置                               |
| `DELETE /settings/file-api`      | 停用并删除令牌记录（含摘要和密文）                                                                                                        |

`expiresInDays` 为 1–3650 的整数，`null` 表示永不过期；省略时为 90。`scopes` 至少选择一项，省略时为读取及写入。时间戳为 Unix 毫秒。

## 错误及一致性

错误统一为 `{"success":false,"data":null,"message":"..."}`。

| HTTP 状态 | 含义                                                          |
| --------- | ------------------------------------------------------------- |
| 400       | 参数、文件 key、文件名、标签、JSON 或 multipart 无效          |
| 401       | 令牌缺失、无效、过期或已撤销；返回 `WWW-Authenticate: Bearer` |
| 403       | 令牌缺少该操作所需权限                                        |
| 404       | 文件不存在                                                    |
| 409       | 管理员获取的密钥仅存摘要或无法解密，需重置                    |
| 413       | 文件或请求体过大                                              |
| 415       | 请求格式不受支持                                              |
| 416       | 下载字节范围不可满足                                          |
| 500       | KV、存储或上游处理失败                                        |
| 503       | 分片存储、进度读取或完成失败，可保留 key 和凭据后重试         |

KV 存在跨地区同步延迟，并发修改采用最后写入覆盖，不提供版本锁或上传幂等键。上传超时后直接重试可能创建重复文件。删除后下游已缓存的公开文件副本无法保证立刻撤回；私有内容应始终通过鉴权接口访问。
