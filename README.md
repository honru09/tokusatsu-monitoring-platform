# 日本特摄中古商品监控平台

面向采购人员的日本中古特摄商品情报系统。默认以假面骑士为主、奥特曼为辅，完整执行“搜索 → 进入详情页 → 规范化 → 文本分类 → 全图异步分类 → 人工复核 → 状态/价格刷新”，而不是只保存搜索标题。

## 已实现范围

- Next.js 采购工作台：在售商品、链接专区、库存与购买、人工审核、监控运行五个独立工作区，支持紧凑商品卡、筛选弹窗、详情抽屉与审计。
- NestJS API：商品列表/详情/修改/审计、服务器时间同步、健康检查、Prometheus 文本指标。
- PostgreSQL：以 `Product` 表示标准商品实体、`Item` 表示各平台 Listing；同一商品可聚合多个来源，并包含系列/角色/厂商/玩具类型词典、审核队列、匹配决策和库存。
- Redis + BullMQ：持久化重复搜索、详情采集、全图分类和动态状态刷新队列。
- Adapter：生产式配置仅启用真实来源。Yahoo! Auctions 使用 Crawlee/Cheerio；Firecrawl 可扩展公开白名单来源；Apify E-commerce 可检索结构化电商结果；Playwright 仅在普通公开页面读取失败时负责动态渲染。采集层不做业务分类，所有来源均实行限速、超时、重试与 Adapter 级熔断。
- 监控同时执行高频增量扫描与循环分页存量回扫。启动时立即预热补扫，之后把市场关键词分散到队列中持续搜罗，不只等待新上架。
- Web 默认显示中文标准名称并可切回原文。粘贴公开商品详情链接后，后台任务进度会在链接专区实时显示，完成后生成与在售库一致的标准商品卡，不会自动收藏。
- 文本规则分类：IP、玩具类型、厂商、成色、数量、单件成本、采购评分；文本与视觉结果分开保存，冲突不会静默覆盖。
- 视觉分类：独立异步包按字段输出 `{ value, confidence, evidence }`。90% 以上自动确认，70%–89% 进入人工审核，低于 70% 的字段保持未知，不猜测。
- 商品归一：日/中/英别名词典先标准化，再用 PostgreSQL trigram、显著词与多因素评分归并 Listing；低可信匹配进入审核队列。
- 容器化：web、api、worker、postgres、redis；PostgreSQL/Redis 使用持久卷，Redis 开启 AOF。

## 目录

```text
apps/
  api/                   NestJS API
  web/                   Next.js 采购看板
workers/
  crawlers/              Adapter、调度、详情、状态 Worker
  classification/        全图视觉分类服务
packages/
  shared/                SourceAdapter、分类与领域类型
  db/                    Prisma schema、migration、seed
  product-dictionary/    日/中/英标准商品词典与别名
services/
  matching/              Trigram、分词和多因素匹配评分
  product-intelligence/  Product 匹配、回填和审核队列
infrastructure/
  docker-compose.yml
scripts/
  preflight.ps1
  deploy.ps1
  smoke.ps1
```

## Windows 一键部署

前置条件：Docker Desktop 的 Linux engine 可用。先运行：

```powershell
./scripts/preflight.ps1
```

如果 Docker 日志显示 `wsl --version failed`，说明系统仍在使用旧版 inbox WSL。请在管理员 PowerShell 中执行 `wsl --update`，按系统提示重启，再重新运行预检。

开发环境可显式开启 Mock Adapter；当前生产式本地部署已关闭 Mock，仅运行真实 Adapter：

```powershell
./scripts/deploy.ps1
```

启用 Mandarake 真实 Adapter：

```powershell
./scripts/deploy.ps1 -EnableRealAdapter
```

服务地址：

- Web：<http://localhost:3000>
- API：<http://localhost:3001>
- 健康检查：<http://localhost:3001/health>
- 指标：<http://localhost:3001/metrics>
- PostgreSQL 主机端口：`55432`（避免与本机常见的 `5432` 冲突）
- Redis：`6379`

## 手动命令

```powershell
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm build
docker compose -f infrastructure/docker-compose.yml up -d --build
./scripts/smoke.ps1
```

查看日志与停止：

```powershell
docker compose -f infrastructure/docker-compose.yml logs -f
docker compose -f infrastructure/docker-compose.yml down
```

数据卷默认保留；只有明确需要清空数据时才可额外使用 `down -v`。

## 配置

复制 `.env.example` 为 `.env`。生产环境至少修改：

- `POSTGRES_PASSWORD`
- `CRAWLER_CONTACT` 与带联系方式的 `CRAWLER_USER_AGENT`
- `CORS_ORIGIN`、`NEXT_PUBLIC_API_BASE_URL`
- `VISION_API_URL`、`VISION_API_KEY`（如需真实图片识别）
- `APIFY_TOKEN` 并将 `APIFY_ECOMMERCE_ENABLED=true`（如需 Apify 电商检索）
- `PLAYWRIGHT_WS_ENDPOINT`（如需在云端使用远程 Chromium 动态页面后备）
- `SENTRY_DSN`（如接入错误追踪）

真实 Adapter 当前已开启。Yahoo 增量搜索每 15 分钟一轮并按关键词错峰；存量回扫每 3 小时完成一轮关键词调度，当前默认覆盖搜索结果前 80 页。拍卖刷新根据剩余时间自动提升到 2 分钟、1 分钟或 30 秒。普通商品默认 60 分钟刷新。所有 BullMQ 任务采用指数退避，连续失败 5 次后打开该 Adapter 的 15 分钟熔断，不影响其他平台。`MOCK_ADAPTER_ENABLED=false` 时 Worker 会清理 Mock 的重复任务和普通待处理任务；队列维护不会误删其他来源的调度器元数据，因此不会再触发 Worker 重启循环。

## 数据语义保证

- `detected_at` 是系统首次发现时间；`listed_at` 只接受平台明确提供的时间，缺失时保持 `NULL`。
- 数据库只保存 UTC `auction_end_at`。Web 每 30 秒更新分钟级倒计时，每 45 秒校准服务器时间，避免无意义的每秒整页重渲染。
- `auction_remaining` 不入库。
- 同平台唯一键为 `(source_id, source_item_id)`；价格、运费、竞拍数变化写入历史。
- 图片分类会接收全部已采集图片 URL；低置信度或文本/图片冲突均设置 `needs_review=true`。
- 人工纠错同时保存修改前后 JSON、操作人、原因和时间。
- 书籍、杂志、漫画与卡片在采集、分类和入库边界均被排除；历史回填也不会把它们创建为 Product。
- 一个 Product 可关联多个平台 Listing；购买后按识别数量更新库存数量与平均成本。

## 合规与上线前检查

- 只访问公开页面，优先官方 API/RSS；每个 Adapter 必须独立验证 robots.txt 和平台条款。
- 不绕过登录、验证码、地理限制或反爬保护；不允许通过提高并发规避限频。
- Mandarake Adapter 的 HTML 选择器已经用固定夹具测试，但真实站点结构变化时应先停用该 Adapter、更新夹具，再恢复。
- 生产上线建议将 PostgreSQL/Redis 改为托管服务或限制主机端口暴露，使用反向代理/TLS，并将密钥放入 secret manager。

## Render 全线上运行

仓库根目录提供 `render.yaml`，会创建常驻 Web、私有 API、后台 Worker、持久化 Key Value 和托管 PostgreSQL。上线后电脑可以关机，采集与数据存储都在 Render 运行。完整步骤见 [`docs/RENDER_DEPLOYMENT.md`](docs/RENDER_DEPLOYMENT.md)。

## 验收

部署脚本最终执行 `scripts/smoke.ps1`，验证 Web、健康检查、商品 API、指标和 Mock Worker 入库。代码侧还包含：

- 分类、数量、`listed_at` 语义与拍卖动态刷新单元测试。
- Mandarake 搜索去重与详情 JSON-LD 解析测试。
- 全工作区严格 TypeScript 类型检查与生产构建。
