#!/usr/bin/env bash
set -e

# ==============================================================================
# 日本特摄监控平台 - Google Cloud (GCP) 一键全自动建机与部署迁移脚本
# 适用环境: Google Cloud Console 自带的 Cloud Shell 终端
# ==============================================================================

echo "========================================================"
echo "🚀 开始在 Google Cloud (GCP) 部署特摄监控云端集群..."
echo "========================================================"

# 1. 确保已选择 GCP Project
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "⚠️ 未检测到默认项目，正在获取项目列表..."
  PROJECT_ID=$(gcloud projects list --format="value(projectId)" --limit=1)
  if [ -z "$PROJECT_ID" ]; then
    echo "❌ 错误: 未找到 GCP 项目。请先在控制台左上角新建一个项目并绑定结算账户。"
    exit 1
  fi
  gcloud config set project "$PROJECT_ID"
fi
echo "✓ 当前使用的 GCP 项目: $PROJECT_ID"

# 2. 启用必要 API (Compute Engine)
echo "📦 正在检查并启用 Compute Engine 服务 API..."
gcloud services enable compute.googleapis.com --project="$PROJECT_ID"

# 3. 创建东京 GCE 虚拟机 (e2-standard-4, 4核16G, 60GB SSD平衡盘)
INSTANCE_NAME="tokusatsu-cloud-server"
ZONE="asia-northeast1-b"

echo "🖥️ 正在东京机房 ($ZONE) 创建高性能云服务器: $INSTANCE_NAME ..."
if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" >/dev/null 2>&1; then
  echo "ℹ️ 实例 $INSTANCE_NAME 已存在，直接复用该机器。"
else
  gcloud compute instances create "$INSTANCE_NAME" \
    --quiet \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --machine-type="e2-standard-4" \
    --network-interface="network-tier=PREMIUM,subnet=default" \
    --maintenance-policy="MIGRATE" \
    --scopes="https://www.googleapis.com/auth/cloud-platform" \
    --image-family="ubuntu-2404-lts-amd64" \
    --image-project="ubuntu-os-cloud" \
    --boot-disk-size="60GB" \
    --boot-disk-type="pd-balanced" \
    --boot-disk-device-name="$INSTANCE_NAME"
  echo "✓ 云服务器创建成功！"
fi

# 等待实例就绪
echo "⏳ 等待云服务器系统网络就绪 (约 15 秒)..."
sleep 15

# 4. 生成目标机内执行的安装与启动脚本
cat << 'REMOTESCRIPT' > /tmp/remote-install.sh
#!/usr/bin/env bash
set -e

echo "=== [1/5] 安装 Docker 与必备工具 ==="
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git gzip

# 安装官方 Docker & Compose
if ! command -v docker &> /dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker $USER
fi

# 安装 Cloudflared
if ! command -v cloudflared &> /dev/null; then
  curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i cloudflared.deb
  rm -f cloudflared.deb
fi

# 安装 Node.js 24 LTS
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
  sudo npm install -g pnpm@11.19.0
fi

echo "=== [2/5] 克隆 GitHub 仓库代码 ==="
cd ~
if [ ! -d "tokusatsu-monitoring-platform" ]; then
  git clone https://github.com/honru09/tokusatsu-monitoring-platform.git
fi
cd tokusatsu-monitoring-platform
git pull origin main

echo "=== [3/5] 还原环境密钥与 Cloudflare 隧道凭据 ==="
cat << 'EOF' > .env
POSTGRES_DB=tokusatsu
POSTGRES_USER=tokusatsu
POSTGRES_PASSWORD=change-me-in-production
DATABASE_URL=postgresql://tokusatsu:change-me-in-production@postgres:5432/tokusatsu?schema=public
REDIS_URL=redis://redis:6379
API_PORT=3001
WEB_PORT=3000
NEXT_PUBLIC_API_BASE_URL=/backend
CORS_ORIGIN=http://localhost:3000,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3002
REAL_ADAPTER_ENABLED=true
MOCK_ADAPTER_ENABLED=false
MANDARAKE_SEARCH_ENABLED=false
YAHOO_AUCTIONS_SEARCH_ENABLED=true
MERCARI_SEARCH_ENABLED=true
YAHOO_FLEAMARKET_SEARCH_ENABLED=true
YAHOO_SHOPPING_SEARCH_ENABLED=false
RAKUMA_SEARCH_ENABLED=true
SURUGAYA_SEARCH_ENABLED=true
MANDARAKE_SEARCH_KEYWORD=仮面ライダー まとめ売り
CRAWLER_USER_AGENT=TokusatsuMonitor/1.0 (+mailto:operator@example.com)
CRAWLER_CONTACT=operator@example.com
MOCK_SEARCH_INTERVAL_MS=900000
REAL_HIGH_PRIORITY_INTERVAL_MS=600000
REAL_SEARCH_INTERVAL_MS=1800000
MERCARI_SEARCH_INTERVAL_MS=1800000
YAHOO_FLEAMARKET_SEARCH_INTERVAL_MS=3600000
RAKUMA_SEARCH_INTERVAL_MS=7200000
SURUGAYA_SEARCH_INTERVAL_MS=10800000
YAHOO_FLEAMARKET_BACKFILL_INTERVAL_MS=21600000
RAKUMA_BACKFILL_INTERVAL_MS=28800000
YAHOO_FLEAMARKET_CRAWL_DELAY_MS=5000
RAKUMA_CRAWL_DELAY_MS=3000
SURUGAYA_CRAWL_DELAY_MS=30000
MANDARAKE_NORMAL_KEYWORD=仮面ライダー
MARKET_KEYWORDS=仮面ライダー|仮面ライダー まとめ売り|仮面ライダー DX|仮面ライダー ベルト|仮面ライダー ソフビ|仮面ライダー 食玩|仮面ライダー ガシャポン|ウルトラマン|特撮 まとめ売り
MARKET_INCREMENTAL_INTERVAL_MS=900000
MARKET_BACKFILL_INTERVAL_MS=10800000
MARKET_BACKFILL_MAX_PAGES=80
FIRECRAWL_DISCOVERY_ENABLED=false
APIFY_ECOMMERCE_ENABLED=false
FIRECRAWL_DISCOVERY_INTERVAL_MS=7200000
FIRECRAWL_API_KEY=
FIRECRAWL_API_URL=https://api.firecrawl.dev
FIRECRAWL_INCLUDE_DOMAINS=jp.mercari.com,item.fril.jp,www.suruga-ya.jp,order.mandarake.co.jp,paypayfleamarket.yahoo.co.jp,item.rakuten.co.jp,www.amazon.co.jp,www.ebay.com,netmall.hardoff.co.jp,store.shopping.yahoo.co.jp
FIRECRAWL_ALLOW_ANY_DOMAIN=false
INVENTORY_CLEANUP_INTERVAL_MS=7200000
LOG_LEVEL=info
SENTRY_DSN=
AI_TIMEOUT_MS=30000
AI_INTERNAL_TOKEN=HxfE7iJz_jxbI7aq-kw1GqMBi1kEgegNnUjnaPTJO04
AI_CATALOG_REFRESH_INTERVAL_MS=21600000
AI_CATALOG_NEGATIVE_CACHE_MS=60000
AI_CATALOG_TIMEOUT_MS=5000
AI_ALLOW_CONFIGURED_CATALOGUE_FALLBACK=true
AI_GEMINI_CATALOGUE_FALLBACK_MODELS=gemini-3.1-flash-lite
AI_OVO_CATALOGUE_FALLBACK_MODELS=gpt-5.6-luna
AI_PROVIDER_CIRCUIT_COOLDOWN_MS=60000
AI_MODEL_TIMEOUT_MS=30000
AI_BACKGROUND_MODEL_TIMEOUT_MS=45000
AI_GATEWAY_DEADLINE_MS=240000
AI_GATEWAY_CLIENT_TIMEOUT_MS=270000
AI_PROXY_TIMEOUT_MS=270000
AI_PRICING_VERIFICATION_MAX_AGE_MS=86400000
AI_PUBLIC_DIAGNOSE_RATE_WINDOW_MS=3600000
AI_PUBLIC_RATE_LIMIT_MAX_BUCKETS=10000
AI_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1,172.16.0.0/12
AI_PUBLIC_ALLOW_PAID_MODELS=true
AI_PUBLIC_CHAT_RATE_WINDOW_MS=900000
AI_PUBLIC_COST_POLICY=free_first
AI_PUBLIC_RATE_LIMIT_CLEANUP_MS=60000
AI_PUBLIC_DIAGNOSE_RATE_LIMIT=2
AI_PUBLIC_CHAT_RATE_LIMIT=12
CLOUDFLARE_ACCOUNT_ID=b18ac2d6e8077c94a26263d0c9e1fb54
AI_PROVIDER_5XX_COOLDOWN_MS=900000
AI_ALLOW_CUSTOM_PROVIDER_ENDPOINTS=false
AI_COOLDOWN_PROBE_INTERVAL_MS=60000
AI_PROVIDER_MAX_CONCURRENCY_OVO=1
AI_PROVIDER_MAX_CONCURRENCY_GEMINI=3
AI_PROVIDER_RPM_GEMINI=12
BACKGROUND_AI_MAX_CONCURRENCY=1
BACKGROUND_AI_COOLDOWN_MS=600000
ZHIPU_API_KEY=dae15408182348ef819c2e6e0b336abf.yzj85qPM0S02Jt4H
ZHIPU_API_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_API_TIER=promotion
ZHIPU_PRIVATE_DATA_AUTHORIZED=true
ZHIPU_FREE_TOKEN_LIMIT=14000000
ZHIPU_DAILY_TOKEN_LIMIT=200000
ZHIPU_FREE_RESOURCE_EXPIRES_AT=2026-11-09T14:35:56+08:00
AI_PROVIDER_ORDER=zhipu
AI_COST_POLICY=free_only
AI_ALLOW_PAID_MODELS=false
AI_HTTP_RETRIES=1
AI_ZHIPU_MAX_CONCURRENCY=1
AI_ZHIPU_MIN_REQUEST_INTERVAL_MS=5000
BACKGROUND_AI_PAID_AUTOMATION_ENABLED=false
BACKGROUND_AI_FREE_AUTOMATION_ENABLED=false
XIANYU_SESSION_URL=http://host.docker.internal:3880
XIANYU_SESSION_TOKEN=fb0efb03f585e715599265a878d376f0b64324f6ea90d53aa875554ca8c325ee
RESALE_MARKET_SEARCH_URL=http://host.docker.internal:3880/search
RESALE_MARKET_SEARCH_TOKEN=fb0efb03f585e715599265a878d376f0b64324f6ea90d53aa875554ca8c325ee
AI_CHAT_PLANNER_ENABLED=false
EOF

# 配置 Cloudflare Named Tunnel
mkdir -p ~/.cloudflared
cat << 'EOF' > ~/.cloudflared/17a1109b-4265-4f09-860c-c7a21a0770d5.json
{"AccountTag":"b18ac2d6e8077c94a26263d0c9e1fb54","TunnelSecret":"uEq7QroW6fwv3rXz7OCNf12hpS+n58hjX/TaZS6Wclk=","TunnelID":"17a1109b-4265-4f09-860c-c7a21a0770d5","Endpoint":""}
EOF

cat << 'EOF' > ~/.cloudflared/config.yml
tunnel: 17a1109b-4265-4f09-860c-c7a21a0770d5
credentials-file: /home/$USER/.cloudflared/17a1109b-4265-4f09-860c-c7a21a0770d5.json
protocol: http2

ingress:
  - hostname: rescue.kamenradar.space
    service: http://localhost:3008
  - hostname: kamenradar.space
    service: http://localhost:3000
  - hostname: www.kamenradar.space
    service: http://localhost:3000
  - hostname: monitor.kamenradar.space
    service: http://localhost:3000
  - hostname: clock.kamenradar.space
    service: http://localhost:5000
  - service: http_status:404
EOF
sed -i "s/\$USER/$USER/g" ~/.cloudflared/config.yml

echo "=== [4/5] 启动 Docker 11 容器集群 ==="
sudo docker compose -f infrastructure/docker-compose.yml up -d --build

echo "⏳ 等待 Docker 容器与数据库迁移初始化就绪..."
for i in $(seq 1 30); do
  if sudo docker exec tokusatsu-monitor-postgres-1 pg_isready -U tokusatsu -d tokusatsu >/dev/null 2>&1; then
    echo "✓ 数据库核心已就绪！"
    break
  fi
  sleep 2
done
sleep 10

# 还原业务全量数据
echo "=== [5/5] 还原 50,000+ 件特摄业务数据与字典 ==="
cd ~/tokusatsu-monitoring-platform
pnpm install --filter @tokusatsu/db
pnpm --filter @tokusatsu/db generate
DATABASE_URL="postgresql://tokusatsu:change-me-in-production@127.0.0.1:55432/tokusatsu?schema=public" node scripts/restore-seeds.cjs || true

# 安装并启动 Cloudflared 服务 (自启动保活)
echo "🌐 启动 Cloudflare 隧道服务..."
sudo mkdir -p /etc/cloudflared
sudo cp -r ~/.cloudflared/* /etc/cloudflared/
sudo cloudflared service install || true
sudo systemctl daemon-reload || true
sudo systemctl restart cloudflared || sudo systemctl enable --now cloudflared || cloudflared run 17a1109b-4265-4f09-860c-c7a21a0770d5 &

echo "========================================================"
echo "🎉 恭喜！特摄监控平台已成功在 Google Cloud 部署上线！"
echo "🌐 公网主站: https://kamenradar.space"
echo "📱 救援控制台: https://rescue.kamenradar.space"
echo "========================================================"
REMOTESCRIPT

# 5. 上传并执行到云服务器 (增加 SSH 重试保护)
echo "🚚 正在将部署流水线传输到云服务器..."
CONNECTED=0
for i in $(seq 1 10); do
  echo "正在连接云服务器 (第 $i/10 次尝试)..."
  if gcloud compute scp --quiet /tmp/remote-install.sh "$INSTANCE_NAME":~/remote-install.sh --zone="$ZONE"; then
    CONNECTED=1
    echo "✓ 部署流水线传输成功！"
    break
  fi
  echo "⏳ 等待 SSH 密钥同步 (10秒)..."
  sleep 10
done

if [ $CONNECTED -eq 0 ]; then
  echo "❌ 无法连接到云服务器，请检查 GCP 实例状态后重试。"
  exit 1
fi

echo "🚀 开始在云服务器内执行部署与数据还原..."
gcloud compute ssh --quiet "$INSTANCE_NAME" --zone="$ZONE" --command="bash ~/remote-install.sh"

echo "✅ 全部迁移流程已完成！"
