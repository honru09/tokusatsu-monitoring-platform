# Render 全线上部署

本项目使用 `render.yaml` 一次创建四项服务：公开 Web、私有 API、常驻采集 Worker、持久化 Key Value，并创建托管 PostgreSQL。网页通过同源 `/backend` 代理访问私有 API，因此浏览器不需要知道内网地址。

## 费用与持续运行

Blueprint 默认使用付费常驻计算和持久化 Key Value。这样 Web 不休眠、Worker 不停机、BullMQ 队列重启后仍保留，电脑关闭后系统也会继续运行。若手动把服务改成 free，后台 Worker 不可用或数据服务可能缺少持久化，不符合持续监控目标。

## 首次上线

1. 把项目根目录初始化为 Git 仓库并推送到 GitHub；确认 `.env` 没有被提交。
2. 登录 Render，选择 **New → Blueprint**，连接该 GitHub 仓库。
3. Render 会读取根目录的 `render.yaml`。确认区域为 Singapore、资源名称无冲突。
4. 在首次创建页面填写标记为 Secret 的变量：
   - `FIRECRAWL_API_KEY`：API 与 Worker 两处填写同一值；没有时先关闭 Worker 的 `FIRECRAWL_DISCOVERY_ENABLED`。
   - `CRAWLER_CONTACT`：真实联系邮箱。
   - `CRAWLER_USER_AGENT`：例如 `TokusatsuMonitor/1.0 (+mailto:you@example.com)`。
   - `VISION_API_URL`、`VISION_API_KEY`：没有视觉服务时可留空，商品会进入人工复核。
5. 点击 **Apply**。API 与 Worker 都会在启动前执行 Prisma migration。
6. 等四项服务与数据库全部变为绿色，打开 `https://tokusatsu-monitor-web.onrender.com`。

## 上线验收

- `https://tokusatsu-monitor-web.onrender.com/api/health` 返回 `status: ok`。
- 首页显示“监控运行中”，最近扫描时间持续变化。
- 存量回扫出现 `backfill` 任务，商品总数能够增加。
- 粘贴公开商品详情链接，任务完成后出现在“链接专区”（不会自动收藏）。
- 首页顶部显示规则/AI 采购分析与性价比排行榜；购买记录在独立工作区保存。
- Worker 每两小时归档已售出、已结束、下架商品，购买记录和凭证不会被清理。
- Render Worker 日志无持续重启、无 Mock Adapter 入库。

## 域名或服务名变化

如果 Render 因重名要求修改 Web 服务名，同时更新 API 的 `CORS_ORIGIN`。网页到 API 的实际访问使用 Render 内网连接，不受公网 API 域名影响。

## 密钥规则

不要把 `.env`、Firecrawl Key、视觉服务 Key 或 Render API Key 提交到 GitHub。Blueprint 中只保留 `sync: false` 占位，密钥由 Render Dashboard 保存。

## 来源自动适配

已配置的公开来源会使用专用解析器；配置 `FIRECRAWL_API_KEY` 后可启用更多来源。若要让 Firecrawl 处理白名单之外的公开 HTTPS 商品页，在 API 与 Worker 同时将 `FIRECRAWL_ALLOW_ANY_DOMAIN=true`，仍会执行 HTTPS、robots.txt、内网地址拦截、超时和限速检查。
