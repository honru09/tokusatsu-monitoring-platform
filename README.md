# 日本特摄中古商品监控平台

面向采购人员的日本中古特摄商品情报系统。默认以假面骑士为主、奥特曼为辅，完整执行“搜索 → 进入详情页 → 规范化 → 文本分类 → 全图异步分类 → 人工复核 → 状态/价格刷新”，而不是只保存搜索标题。

## 已实现范围

- Next.js 采购看板：商品卡、十余项筛选、详情抽屉、收藏、忽略、人工纠错与审计。
- NestJS API：商品列表/详情/修改/审计、服务器时间同步、健康检查、Prometheus 文本指标。
- PostgreSQL：sources、items、item_images、item_price_history、item_classifications、sellers、physical_stores、crawl_jobs、alerts、manual_reviews。
- Redis + BullMQ：持久化重复搜索、详情采集、全图分类和动态状态刷新队列。
- Adapter：生产式配置仅启用真实来源。Yahoo! Auctions 使用 Crawlee/Cheerio 进行公开搜索与详情采集；Mercari、Mandarake 负责链接分析；Firecrawl 可在配置 Key 后扩展 Rakuma、駿河屋等白名单来源。所有来源遵守 robots.txt，并实行限速、超时、重试与 Adapter 级熔断。
- 监控同时执行高频增量扫描与循环分页存量回扫。启动时立即预热补扫，之后把市场关键词分散到队列中持续搜罗，不只等待新上架。
- Web 支持紧凑商品卡、弹窗筛选器、收起式迷你收藏卡、监控运行指标，以及中文术语转写/原文切换。粘贴公开商品详情链接后，分析完成会自动收藏并多次刷新结果。
- 文本规则分类：IP、玩具类型、厂商、成色、数量、单件成本、采购评分；文本与视觉结果分开保存，冲突不会静默覆盖。
- 视觉分类：独立异步包，支持通用 HTTP 视觉服务；未配置服务时返回低置信度占位结果并进入人工复核，绝不伪装成已完成识别。
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
- `SENTRY_DSN`（如接入错误追踪）

真实 Adapter 当前已开启。Yahoo 增量搜索每 15 分钟一轮并按关键词错峰；存量回扫每 3 小时完成一轮关键词调度，当前默认覆盖搜索结果前 80 页。拍卖刷新根据剩余时间自动提升到 2 分钟、1 分钟或 30 秒。普通商品默认 60 分钟刷新。所有 BullMQ 任务采用指数退避，连续失败 5 次后打开该 Adapter 的 15 分钟熔断，不影响其他平台。`MOCK_ADAPTER_ENABLED=false` 时 Worker 会清理 Mock 的重复任务和普通待处理任务；队列维护不会误删其他来源的调度器元数据，因此不会再触发 Worker 重启循环。

## 数据语义保证

- `detected_at` 是系统首次发现时间；`listed_at` 只接受平台明确提供的时间，缺失时保持 `NULL`。
- 数据库只保存 UTC `auction_end_at`。Web 每 30 秒更新分钟级倒计时，每 45 秒校准服务器时间，避免无意义的每秒整页重渲染。
- `auction_remaining` 不入库。
- 同平台唯一键为 `(source_id, source_item_id)`；价格、运费、竞拍数变化写入历史。
- 图片分类会接收全部已采集图片 URL；低置信度或文本/图片冲突均设置 `needs_review=true`。
- 人工纠错同时保存修改前后 JSON、操作人、原因和时间。

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
