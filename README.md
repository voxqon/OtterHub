# OtterHub

<p align="center">
  <img width="100" alt="OtterHub icon" src="public/otterhub-icon.svg">
</p>
<p align="center"><strong>Stash your files like an otter</strong></p>

<p align="center">
  基于 Cloudflare Pages + KV，支持 Telegram / R2 存储的私人云盘
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Pages%20%2B%20KV%20%2B%20R2-orange?logo=cloudflare" />
  <img src="https://img.shields.io/badge/Storage-Telegram-blue?logo=telegram" />
  <img src="https://img.shields.io/badge/Frontend-Next.js-black?logo=next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript" />
</p>

> [!CAUTION]
> **Breaking Change**
>
> `JWT_SECRET` 现为必需配置项。
>
> 升级前请在环境变量中配置：
>
> ```env
> JWT_SECRET=your-secure-random-secret
> ```
>
> 未配置 `JWT_SECRET` 将无法登录。
>
> 启用 Telegram Webhook 导入时还必须配置 `TG_WEBHOOK_SECRET`；未配置时导入接口返回 503，错误或缺少校验头时返回 401。

---

## 👋 为什么有 OtterHub？

现有基于 **Cloudflare + Telegram** 的文件存储方案，例如：

- [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image)
- [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)

它们都很优秀，但要么偏向**图床与轻量分享**，要么为了通用性引入了**较高的复杂度**，并不完全适合**长期自用的私人云盘**。

### OtterHub 的定位

> 像水獭一样，把文件悄悄藏好，需要时再拿出来 🦦

OtterHub 是一个 **为个人使用场景定制** 的私人云盘方案：

- 基于 **Cloudflare Pages + KV**（最终一致性，上传后存在短暂同步延迟）
- 配置 `TG_BOT_TOKEN` 时使用 **Telegram Bot** 存储，未配置时使用绑定的 **R2**
- 通过 **分片上传** 突破 20MB 单文件限制
- 支持 **HTTP Range**，适合视频 / 大文件访问
- 架构克制、状态最小化，优先长期可维护性

它不追求"什么都支持"，而是专注于**刚好够用、稳定、好维护**。

> [!IMPORTANT]
> 体验站点：[OtterHub Demo](https://otterhub-demo.pages.dev/)
>
> 账号：`OtterHub` | 密码：`123456`
>
> 限制：演示站的默认文件不可删，仅支持上传 ≤20MB 文件（1 小时自动清理）

![网站截图](public/website-screenshot.png)

## ✨ 核心能力

- **私人文件存储**：
  - 支持图片 / 音频 / 视频 / 文档
  - KV Key 按类型划分前缀 `img:` `audio:` `video:` `doc:`，提升查询效率
  - 提供回收站功能，记录保留 30 天，支持恢复和永久删除
- **大文件支持**：
  - 分片上传，每片最多 **20 MiB**，最多 50 片，单文件上限 **1000 MiB**
  - 支持 HTTP Range，视频/音频按需加载；中断上传可重新选择原文件续传
- **实时预览**：
  - 通过文件 URL 直接打开，无需下载
  - 支持：图片 / 音频 / 视频 / 文本（txt、pdf 等）
- **可控性能与流量**：
  - 非 Range 请求走 Cloudflare Cache，Range 请求直出避免缓存污染
  - 图片加载策略：默认 / 省流（>5MB 不加载）/ 无图
- **安全与私密**：
  - 密码登录（基于 JWT + Cookie）
  - 管理接口始终鉴权；`private` 文件和回收站内容需要管理员身份访问
  - 临时分享支持到期、撤销和私有文件授权访问，分享响应不缓存
  - NSFW 图片客户端检测（nsfw.js），安全模式下自动遮罩
- **基础管理功能**：批量下载 / 删除，搜索 / 收藏 / 排序 / 标签
- **Telegram 频道上传**：频道 / 群内发送 ≤20MB 文件后自动注册到 OtterHub，并可回复直链
- **AI 图片分析**：网页端上传图片后可自动生成简要描述，便于图片检索（需配置 Workers AI binding，可在设置页关闭）
- **公共上传接口**：独立 HMAC-SHA256 密钥，只授权上传，不开放文件管理能力；见[公共上传接口文档](docs/public-api.md)

> 默认上传文件可通过直链公开访问。需要私密存储时，请在设置中将 `private` 设为默认上传标签，或编辑文件标签。回收站记录过期只会清理 KV 索引；Telegram 原消息、未完成上传产生的存储对象，以及过期回收站对应的 R2 对象没有定时清理任务。

---

## 🚀 快速开始

### 前置要求

- Node.js 20.9+
- Cloudflare 账号（免费，部署需要）
- Telegram Bot Token（生产默认存储需要；本地开发默认不需要）

### 本地开发

1. **安装依赖**

   ```bash
   # 在根目录运行，自动安装所有 Workspaces 依赖
   npm install
   ```

2. **构建静态资源并启动项目**

   ```bash
   npm run build
   npm run dev
   ```

   > 首次构建生成 `frontend/out`，供 Wrangler Pages Dev 使用。后续前端开发由 Next.js 热更新，通常直接运行 `npm run dev`。Windows 下执行新的生产构建前，请先停止使用 `frontend/out` 的本地服务，避免目录被锁定。

3. **访问网站**
   - 前端：`http://localhost:3000`
   - 后端：`http://localhost:8788`

`frontend/.env.development` 提供开发环境的后端地址。需要修改端口或使用独立后端时，在 `frontend/.env.development.local` 设置 `NEXT_PUBLIC_BACKEND_URL`；修改后重启前端。生产环境默认请求当前站点，仅在确实需要独立后端时设置此构建变量。

> [!TIP]
> 开发环境下密码为`123456`，且采用本地 R2 存储，可以直接上传文件，方便调试。

### 提交前检查

常用检查命令：

```bash
npm run lint         # 前端 ESLint
npm run typecheck    # 检查前端、共享代码及前端引用的后端类型
npm test             # 逻辑与公共上传 API 回归，无需启动 Wrangler
npm run build        # 类型检查及静态导出
npm run ci-test      # 启动本地 Wrangler，运行全部 Mocha 测试后停止服务
```

提交前的 Husky 钩子会对暂存文件运行 Prettier，并执行 `npm run typecheck`。GitHub Actions 会运行 lint、类型检查、构建和 `ci-test`；仓库没有 push 前钩子。

`ci-test` 使用 8788 端口和本地 `data` 目录，运行前请停止占用该端口的开发后端；应在测试用数据目录中运行。已有测试服务时，可用 `TEST_API_URL` 指定地址，直接运行 `npx mocha test/test.js --timeout 15000`。

`npm run test:optimization` 仅运行逻辑回归。默认测试会跳过 Telegram HTTP 模拟组；设置 `TG_SIM_URL` 后可运行该组，具体命令与验证范围见[模拟测试记录](postman/simulations/otterhub-storage.context.md)和[上传协议](docs/upload-protocol.md)。模拟通过不代表真实 Telegram 或跨地区 KV 一致性已验证。

---

## 📦 Cloudflare 部署

### 1. 创建 Pages 项目

Fork 本项目，然后在 Cloudflare Dashboard 创建 Pages 项目：

- **构建命令**: `npm install && npm run build`
- **构建输出目录**: `frontend/out`

### 2. 配置环境变量

在 Pages 项目的设置中添加以下环境变量：

```env
PASSWORD=your_password          # 密码
JWT_SECRET=your_jwt_secret      # JWT 签名密钥（必填），建议 32 位以上随机字符串
TG_CHAT_ID=your_tg_chat_id      # Telegram Chat ID
TG_BOT_TOKEN=your_tg_bot_token  # Telegram Bot Token
API_TOKEN=your_api_token        # (可选) 用于 API 调用的 Token

# Telegram 频道/群组上传
TG_WEBHOOK_SECRET=your_secret   # 自定义 Webhook 校验密钥，建议 32 位以上随机字符串
```

> `TG_CHAT_ID` 和 `TG_BOT_TOKEN` 需在 Telegram 中获取。
> 💡 详细流程可参考：[Telegraph-Image](https://github.com/cf-pages/Telegraph-Image)

`PASSWORD` 用于网页登录，`JWT_SECRET` 用于登录会话及分片确认凭据，两者用途不同。`API_TOKEN` 具有管理权限，应保存在可信服务端。公共上传密钥通过设置页生成并保存在 KV，无需额外环境变量。

若使用 R2，请不配置 `TG_BOT_TOKEN`，并绑定 R2 bucket，变量名为 `oh_file_r2`。R2 和 Telegram 共用 KV 元数据索引；切换存储不会迁移已有文件内容，需自行迁移数据。

<details>
<summary>从 Telegram 频道/群组上传文件</summary>

**前置条件**

1. 在 Cloudflare Pages 环境变量中配置 `TG_WEBHOOK_SECRET`（建议 32 位以上随机字符串，用于校验 Webhook 请求来源）
2. Bot 会使用当前部署域名配置 Webhook，并在文件收录成功后回复直链

**配置步骤**

1. 将 Bot 加入目标频道 / 群，并授予**读取消息**和**发送消息**权限
2. 部署完成后进入 OtterHub 设置页 → 常规设置 → 上传设置
3. 点击「配置 Webhook」，再点击「检查状态」确认已绑定

**手动配置 Webhook（调试使用）**

```bash
# 1. 生成随机密钥（PowerShell 示例）
$SECRET = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
Write-Host "生成的密钥: $SECRET"

# 2. 先设置环境变量 TG_WEBHOOK_SECRET = $SECRET，然后调用 setWebhook
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://你的域名/telegram/webhook\",\"secret_token\":\"$SECRET\",\"allowed_updates\":[\"message\",\"channel_post\"]}"

# 3. 验证状态
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

> [!NOTE]
> **仅支持 ≤20MB 文件上传**，超过 20MB 的文件请使用 OtterHub 网页端上传以支持分片上传。

</details>

### 3. 绑定 KV Namespace

1. 在 Cloudflare Dashboard 创建 KV 命名空间 `oh_file_url`
2. 将 `oh_file_url` 绑定到 Pages 项目，变量名也设为 `oh_file_url`

### 4. （可选）绑定 Workers AI

如需启用图片自动分析功能：

1. 进入 Pages 项目 -> **Settings -> Functions -> AI Bindings**
2. 点击「Add binding」，**变量名填 `AI`**，选择默认 Workers AI 资源

> 该功能默认启用，可在 OtterHub 设置页 -> 常规设置 -> 上传设置中关闭。

### 5. 重新部署

回到部署页面重试部署，让环境变量和 KV 绑定生效。

---

## 🔧 技术原理

### 文件上传

> 以大文件分片上传流程为例

1. **初始化上传**
   - 前端发送 `POST /upload/chunk/init` 请求
   - 以 JSON 携带文件类型、名称、大小、总分片数和默认标签
   - 后端校验文件大小与分片数量，创建保留 1 小时的临时元数据，返回唯一文件 key

2. **分片上传与确认**
   - 前端将文件分片（每片 ≤ 20MB）
   - 携带 key 逐个发送 `POST /upload/chunk`
   - 新客户端携带 `returnReceipt=true`，后端直接上传到目标存储
   - 上传成功后返回签名确认凭据，每片独立保存进度，避免并发覆盖
   - 无需将分片二进制内容写入、读出临时 KV

3. **提交完成**
   - 前端携带全部凭据发送 `POST /upload/chunk/complete`
   - 后端校验分片完整性、大小与签名后，一次写入最终清单
   - 响应中返回完整元数据，界面立即更新，无需轮询进度或刷新页面
   - 续传时仅查询一次已确认的分片进度

### 文件下载

> 以大文件流式获取流程为例

1. **读取元数据**
   - 从 KV 读取文件元数据和分片信息
   - 解析 chunks 数组中的 file_id

2. **流式拉取**
   - 从 Telegram API 流式拉取所有分片
   - 支持 HTTP Range 请求
   - 边拉取边返回给客户端

3. **按范围下载**
   - 支持 Range 请求头
   - 支持普通范围、开放结束范围和后缀范围，例如 `bytes=0-99`、`bytes=100-`、`bytes=-100`
   - 合法范围返回 206，无法满足或不支持的多范围请求返回 416

### 数据存储结构

> 以 30MB 文件为例

#### KV Key + Metadata 结构

```json
{
  "name": "video:chunk_7yHZkP0bzyUN5VLE.mp4",
  "metadata": {
    "fileName": "示例视频-1080P.mp4",
    "fileSize": 30202507,
    "uploadedAt": 1768059589484,
    "liked": false,
    "chunkInfo": {
      "total": 2,
      "uploadedIndices": [0, 1]
    }
  }
}
```

#### KV Value 结构（chunks 数组）

```json
[
  {
    "idx": 0,
    "file_id": "BQACAgUAAyEGAASJIjr1AAIDbGlictIJ9om0qQ66ZW4GssRXCARUAAKAHwAC...",
    "size": 20971520
  },
  {
    "idx": 1,
    "file_id": "BQACAgUAAyEGAASJIjr1AAIDa2lictGSBOJ24LnypIN5JCmV2u77AAJ_HwAC...",
    "size": 9230987
  }
]
```

KV 保存文件索引、元数据、分享记录、设置和临时分片确认记录。实际占用取决于文件名、标签、描述和分片数量，不能按固定的单文件字节数推算容量；文件二进制内容保存在 Telegram 或 R2。

### 访问、分享与回收站

| 入口                                                                    | 访问要求                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 文件列表、上传、编辑、删除、回收站管理、系统设置                        | 管理员 Cookie 或 `Authorization: Bearer <API_TOKEN>`             |
| `/file/:key`、`/file/:key/download`                                     | 普通文件允许直链访问；`private` 文件及回收站文件必须管理员鉴权   |
| `/share/:token/meta`、`/share/:token/raw`、`/share/:token/download-all` | 有效分享令牌；可临时访问已分享的私有文件                         |
| `POST /public/upload`                                                   | 独立公共上传密钥签名，详见[公共上传接口文档](docs/public-api.md) |
| `POST /telegram/webhook`                                                | 已配置 `TG_WEBHOOK_SECRET`，且校验头匹配                         |

创建分享使用 `POST /share/create`。`expireIn` 为至少 60 秒的整数，省略时创建永久分享；单文件用 `fileKey`，打包分享用 `type: "bundle"` 和 `fileKeys`。分享列表会遍历 KV 分页并过滤过期记录，ZIP 打包下载最多支持 50 个文件。

分享元数据与内容响应均设为 `private, no-store`。到期后返回 404；撤销会删除 KV 分享记录，跨地区生效时间仍受 KV 最终一致性影响。已经下载的文件无法撤回。

移入回收站只改变 KV 索引，恢复会移除回收站前缀并取消过期时间。R2 手动永久删除会删除原始对象或分片；Telegram 模式只删除索引，不会删除 Telegram 中的原消息。

---

## ❓ 常见问题

<details>
<summary>1. 上传完成后立即查看，为什么文件不完整？</summary>

新版网页会等待所有分片上传确认并提交完整清单，再显示成功。
上传中断的文件可以选择原文件继续上传，不必重传已经确认的分片。

Cloudflare KV 跨地区仍采用最终一致性，因此其他设备可能短暂看到旧列表；
返回页面、网络恢复或切换文件类型时会按需同步。仍使用旧版异步上传接口的
客户端，需要查询 `/upload/chunk/progress` 完成进度确认。

</details>

<details>
<summary>2. Telegram 单文件限制 20MB，OtterHub 如何支持大文件？</summary>

通过 **分片上传 + 流式合并** 实现：

- 前端将文件拆分为多个 ≤20MB 的分片
- 每个分片独立上传到 Telegram
- 服务端记录分片 `file_id`
- 下载时按顺序流式拉取并合并

👉 当前代码上限为 **1000 MiB（50 × 20 MiB，约 0.98 GiB）**，实际上传仍受部署环境资源和上游可用性影响。

</details>

<details>
<summary>3. Cloudflare Workers 免费版是否够用？</summary>

取决于请求量、KV 读写次数、文件大小和存储模式。浏览器上传队列在不同文件间共享两个上传槽；下载按需读取分片，取消下载会停止后续读取。请按实际使用量检查 Cloudflare 与 Telegram 的服务额度。

> 具体限制参考官方文档：https://developers.cloudflare.com/workers/platform/limits/

</details>

<details>
<summary>4. 如何获取 Telegram Bot Token 和 Chat ID？</summary>

以下为 AI 生成，详细流程可参考：[Telegraph-Image](https://github.com/cf-pages/Telegraph-Image)

**Bot Token**

1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot`
3. 保存返回的 Token

**Chat ID**

- 搜索 `@userinfobot` 并发送任意消息
- 或访问：
  `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
  </details>

---

## 📂 项目结构

```
OtterHub/
├── frontend/           # Next.js Frontend
│   ├── lib/
│   │   ├── api/        # Hono RPC Client (Type-safe)
│   │   │   ├── client.ts # RPC Client Instance
│   │   │   └── ...
│   └── ...
├── functions/          # Cloudflare Pages Functions (Hono Backend)
│   ├── routes/         # 业务路由模块
│   │   ├── file/       # 文件操作
│   │   ├── upload/     # 上传逻辑
│   │   ├── wallpaper/  # 壁纸服务
│   │   └── ...
│   ├── middleware/     # 中间件 (Auth, CORS)
│   ├── utils/          # 工具库
│   │   ├── db-adapter/ # 存储适配器 (Telegram/R2)
│   │   ├── proxy/      # 代理
│   │   └── ...
│   ├── routes/telegram # Telegram Webhook 导入与配置
│   ├── app.ts          # Hono App 定义 & AppType 导出
│   └── [[path]].ts     # Pages Functions 入口
├── shared/             # 前后端共享类型/工具 (Workspaces)
├── docs/               # 上传协议、公共上传 API 说明
├── postman/            # Telegram 契约、HTTP 模拟与验证记录
├── test/               # 逻辑回归、公共 API 与 Wrangler KV/R2 集成测试
├── public/             # 静态资源
├── package.json        # Monorepo 配置
├── wrangler.jsonc      # Wrangler 配置（本地开发/静态资源）
└── README.md
```

---

## 🔍 参考资料

- [Cloudflare API](https://developers.cloudflare.com/api)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image) - CF + TG 文件存储方案来源
- [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) - DB 适配器 & 分片上传设计的灵感来源

---

## 📋 TODO

- [x] 核心能力
  - [x] 基于 Cookie 实现密码登录、登出功能
  - [x] 分片上传（≤20 MiB / 片），确认凭据完成提交，最大 1000 MiB
  - [x] Telegram 频道 / 群上传导入（Webhook 注册 ≤20MB 文件的 `file_id`）
  - [x] HTTP Range 支持（视频 / 音频按需加载、断点续传）
  - [x] Private 私有文件访问控制
  - [x] 回收站功能（支持恢复 / 永久删除 / 自动清理）

- [x] 文件管理
  - [x] 分页获取文件列表
  - [x] 批量操作（复制 / 删除 / 重命名）
  - [x] 收藏（Liked）和标签（Tag）
  - [x] 筛选功能（按标签 / 按收藏 / 按日期范围）和排序功能（文件大小 / 文件名称 / 上传时间）
  - [x] 临时分享文件（无论是否 Private 都可以访问）
    - [x] KV实现, 永久 / 有效期 URL （允许用户选择）
    - [x] key: `share:<uuid>`
    - [x] value: 单文件或打包分享信息

- [x] 预览与展示
  - [x] 图片瀑布流（支持 GIF）
  - [x] 视频缩略图（Telegram thumbnail），仅 20MB 内的视频文件支持
  - [x] 纯文本文件预览（TXT / MD / JSON 等）
  - [x] 图片加载策略（默认 / 省流 / 无图）

- [x] 安全与体验
  - [x] 日夜模式
  - [x] 移动端基础适配
  - [x] NSFWJS 客户端检测（安全模式遮罩）
  - [x] 右下角悬浮按钮（FAB），多操作统一入口（登出、管理页面、回收站）
  - [x] AI 图片分析

---

### Low Priority

- [x] 随机壁纸获取（Wallhaven、Bing、Pixabay 等）
- [x] API Token 支持 (通过 `API_TOKEN` 环境变量配置)
- [x] 公共上传 API（HMAC-SHA256 签名，独立密钥生成、轮换与停用）
- [ ] 申请 TG API ID，自建 Telegram Bot API Server, 单个文件下载上限可提升至 2GB
- [ ] ~~TG Webhook 上传同步文件标签~~（会额外消耗一次 KV 读取额度）

- [ ] KV vs D1 数据库评估
  - 优点：SQL、关系模型、文件夹结构更自然
  - 当前结论：KV 足够，暂不迁移
- [ ] ~~文件夹系统~~ （已通过「文件名前缀 + 搜索 + Tag」实现等效能力）

---

## 🤝 Contributing

欢迎提交 **Issue** 反馈问题或建议新功能，也欢迎 **Pull Request** 一起完善项目！
觉得有用的话，点个 ⭐️ 支持一下吧！
