#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "project-175c4bc7-52ff-4b6d-b53")
ZONE="asia-northeast1-b"
INSTANCE_NAME="tokusatsu-cloud-server"

echo "=========================================================="
echo "🚀 正在同步 GitHub 最新代码并更新 Google Cloud 生产集群..."
echo "Project:  $PROJECT_ID"
echo "Instance: $INSTANCE_NAME ($ZONE)"
echo "=========================================================="

# 确保实例处于运行状态
STATUS=$(gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --project="$PROJECT_ID" --format="value(status)" 2>/dev/null || echo "UNKNOWN")
if [ "$STATUS" != "RUNNING" ]; then
  echo "⏳ 实例当前状态为 $STATUS，正在启动..."
  gcloud compute instances start "$INSTANCE_NAME" --zone="$ZONE" --project="$PROJECT_ID" --quiet
  sleep 15
fi

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --project="$PROJECT_ID" --command='
  set -e
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJTJxLUCje9AiRdzThzE97pQu4QzmZQ7LqujYi075MIE hongrun01@gmail.com"
  if ! grep -qF "$PUBKEY" ~/.ssh/authorized_keys 2>/dev/null; then
    echo "$PUBKEY" >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
    echo "✓ 已写入开发机直连公钥"
  fi

  cd ~/tokusatsu-monitoring-platform
  echo "📦 拉取 GitHub main 最新代码..."
  git fetch origin main
  git reset --hard origin/main
  cp .env infrastructure/.env || true

  echo "🔨 重新构建并热更新 api 与 web 容器..."
  sudo docker compose --env-file .env -f infrastructure/docker-compose.yml up -d --build api web worker

  echo "⚙️ 配置 GitHub 自动同步更新脚本 (每 5 分钟检查一次新提交)..."
  cat << "AUTOCD" > ~/auto-cd.sh
#!/usr/bin/env bash
cd ~/tokusatsu-monitoring-platform || exit 0
git fetch origin main >/dev/null 2>&1 || exit 0
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[$(date -Is)] Updating from $LOCAL to $REMOTE" >> ~/auto-cd.log
  git reset --hard origin/main >> ~/auto-cd.log 2>&1
  cp .env infrastructure/.env 2>/dev/null || true
  sudo docker compose --env-file .env -f infrastructure/docker-compose.yml up -d --build api web worker >> ~/auto-cd.log 2>&1
fi
AUTOCD
  chmod +x ~/auto-cd.sh
  (crontab -l 2>/dev/null | grep -v "auto-cd.sh"; echo "*/5 * * * * /bin/bash ~/auto-cd.sh") | crontab -

  echo "✅ Google Cloud 容器集群已更新至最新提交: $(git rev-parse --short HEAD)"
  sudo docker compose --env-file .env -f infrastructure/docker-compose.yml ps
'

echo "=========================================================="
echo "🎉 更新完成！现在访问 https://kamenradar.space 即可使用最新版！"
echo "=========================================================="
