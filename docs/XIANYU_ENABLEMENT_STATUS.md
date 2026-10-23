# 闲鱼与性价比之王：部署实况

本页记录历史跨市场比价链路。2026-10-09 新增的闲鱼转售模块已有独立的官方浏览器登录与搜索连接，见 [闲鱼自动化集成](XIANYU_AUTOMATION_INTEGRATION.md)。这不表示本页的跨市场比价、Apify 或机会评估调度已开启。

2026-09-30 只读复核：

- Worker：CHINA_MARKET_COMPARISON_ENABLED / CHINA_MARKET_COMPARISON_AUTHORIZED / XIANYU_COMPARISON_ENABLED 均 false。
- XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED / XIANYU_REVERSE_SEARCH_ENABLED / BACKGROUND_AI_PAID_AUTOMATION_ENABLED 均 false。
- 未配置 APIFY_TOKEN，未配置 XIANYU_SEARCH_API_URL。
- china-market-comparison 队列所有计数0，无重复调度。
- product_market_comparisons、china_market_comparison_runs、cross_market_opportunities 均无记录；首页闲鱼对比与性价比之王计数均0。

结论：筛选和展示代码存在，但闲鱼链路目前没有启动，不能说已经在持续收录。

## 开启前需要

二选一：

1. Apify 账号提供能运行指定 Actor 的 Token，并确认该 Actor 的费用与账号余额。项目已接入 `zen-studio~goofish-xianyu-search-scraper`，使用 `APIFY_TOKEN` 与 `XIANYU_APIFY_ACTOR`。Token只放本地密钥文件/服务端环境，不能放浏览器或发到聊天。
2. 提供已授权的闲鱼搜索服务地址和Token。配置 `XIANYU_SEARCH_API_URL`、`XIANYU_SEARCH_API_TOKEN`。服务需返回真实商品链接、标题、人民币价格和在售证据，不能仅返回抓取数量或本地数据库ID。

授权和费用确认后：开启对比三个开关，先小批量测出可重复的真实同款；至少3个有效同款才能形成参考价。再开启机会评估、配置国际运费/平台费/国内履约成本，验证数量、品相和时效，最后启用周期调度。

`BACKGROUND_AI_PAID_AUTOMATION_ENABLED` 是共享付费 AI 开关，不是闲鱼采集开关。闲鱼调度已与它解耦；关闭时自动使用确定性关键词和严格匹配后备，不应为启动闲鱼而打开全局付费 AI。

2026-09-30 修复：此前调度器和处理器额外检查了该共享付费 AI 开关，导致闲鱼自己的三个授权开关与 Provider 即使配置正确，队列仍可能保持空白。该错误门禁已经移除并有回归测试覆盖。

若出现登录、验证码或风控，任务应暂停等待人工处理，不绕过。性价比之王是有证据的筛选结果，不是稳赚或保证可以直接购买的承诺。

官方参考：

- [Apify API token与权限](https://docs.apify.com/integrations/api)
- [当前项目接入的闲鱼Actor](https://apify.com/zen-studio/goofish-xianyu-search-scraper)
