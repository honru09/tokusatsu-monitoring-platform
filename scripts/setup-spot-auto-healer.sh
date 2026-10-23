#!/bin/bash
set -euo pipefail

# ==============================================================================
# Tokusatsu Cloud Platform - Spot VM Conversion & Auto-Healing Watchdog Setup
# ==============================================================================
# 目标：
# 1. 将 VM 规格降配为 e2-standard-2 (2核 8G) 并切换为 Spot 抢占式实例 (立省 80%)
# 2. 部署云端原生自动化看门狗 (Cloud Workflows + Cloud Scheduler)，每 3 分钟自动探活
# 3. 若 Spot 实例被 Google 临时抢占回收关机，看门狗自动检测并秒级重新开机
# ==============================================================================

PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "project-175c4bc7-52ff-4b6d-b53")
ZONE="asia-northeast1-b"
REGION="asia-northeast1"
INSTANCE_NAME="tokusatsu-cloud-server"
SA_NAME="spot-auto-healer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
WORKFLOW_NAME="spot-vm-auto-healer"
JOB_NAME="spot-vm-watchdog-cron"

echo "=========================================================="
echo "开始执行 Spot 降配与自动化自愈开机配置"
echo "Project ID: $PROJECT_ID"
echo "Instance:   $INSTANCE_NAME ($ZONE)"
echo "Target:     e2-standard-2 (Spot)"
echo "=========================================================="

# 1. 启用必要云端 API
echo "[1/6] 启用 Cloud Workflows & Cloud Scheduler 基础服务..."
gcloud services enable \
    workflows.googleapis.com \
    cloudscheduler.googleapis.com \
    workflowexecutions.googleapis.com \
    compute.googleapis.com --project="$PROJECT_ID"

# 2. 创建或更新专用运维服务账号
echo "[2/6] 配置自动化运维服务账号与权限..."
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA_NAME" \
        --project="$PROJECT_ID" \
        --description="Service account for auto-restarting preempted Spot VM" \
        --display-name="Spot VM Auto Healer"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/compute.instanceAdmin.v1" \
    --condition=None >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/workflows.invoker" \
    --condition=None >/dev/null

# 3. 创建自愈工作流定义文件
echo "[3/6] 生成云端自愈工作流 (Workflow Definition)..."
cat << 'EOF' > /tmp/spot-auto-healer-workflow.yaml
main:
  params: [args]
  steps:
    - init:
        assign:
          - projectId: ${sys.get_env("GOOGLE_CLOUD_PROJECT_ID")}
          - zone: "asia-northeast1-b"
          - instanceName: "tokusatsu-cloud-server"

    - check_instance_status:
        call: googleapis.compute.v1.instances.get
        args:
          project: ${projectId}
          zone: ${zone}
          instance: ${instanceName}
        result: instanceDetails

    - evaluate_status:
        switch:
          - condition: ${instanceDetails.status == "RUNNING"}
            next: instance_running

          - condition: ${instanceDetails.status == "TERMINATED" or instanceDetails.status == "STOPPED"}
            next: start_instance

        next: unknown_status

    - start_instance:
        try:
          call: googleapis.compute.v1.instances.start
          args:
            project: ${projectId}
            zone: ${zone}
            instance: ${instanceName}
          result: startResult
        except:
          as: err
          steps:
            - log_capacity_wait:
                call: sys.log
                args:
                  data: ${"Spot capacity temporarily unavailable, will retry next cycle: " + err.message}
                next: end

    - log_started:
        call: sys.log
        args:
          data: ${"Spot VM " + instanceName + " was preempted/stopped and has been successfully restarted!"}
        next: end

    - instance_running:
        call: sys.log
        args:
          data: ${"Spot VM " + instanceName + " is healthy and RUNNING."}
        next: end

    - unknown_status:
        call: sys.log
        args:
          data: ${"Instance is in state " + instanceDetails.status + ", waiting for next cycle."}
        next: end
EOF

# 4. 部署 Cloud Workflow
echo "[4/6] 部署自动化自愈工作流到东京机房..."
gcloud workflows deploy "$WORKFLOW_NAME" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --source=/tmp/spot-auto-healer-workflow.yaml \
    --service-account="$SA_EMAIL"

# 5. 配置 Cloud Scheduler 定时探活触发器 (每 3 分钟执行一次)
echo "[5/6] 配置 Cloud Scheduler 高频探活定时器 (每 3 分钟)..."
WORKFLOW_EXEC_URI="https://workflowexecutions.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}/executions"

if gcloud scheduler jobs describe "$JOB_NAME" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs delete "$JOB_NAME" --location="$REGION" --project="$PROJECT_ID" --quiet
fi

gcloud scheduler jobs create http "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --schedule="*/3 * * * *" \
    --time-zone="Asia/Tokyo" \
    --uri="$WORKFLOW_EXEC_URI" \
    --http-method="POST" \
    --oauth-service-account-email="$SA_EMAIL" \
    --description="Trigger spot VM auto-healer every 3 minutes"

# 6. 将当前 VM 停止、变更为 e2-standard-2 Spot 并重新启动
echo "[6/6] 切换当前服务器为 e2-standard-2 (Spot)..."
echo ">> 正在安全停止虚拟机 (保持磁盘完好)..."
gcloud compute instances stop "$INSTANCE_NAME" --zone="$ZONE" --project="$PROJECT_ID" --quiet

echo ">> 更改机器规格为 e2-standard-2 (2核 8G)..."
gcloud compute instances set-machine-type "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --project="$PROJECT_ID" \
    --machine-type="e2-standard-2"

echo ">> 更改调度策略为 SPOT 抢占式 (保留磁盘与数据)..."
gcloud compute instances set-scheduling "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --project="$PROJECT_ID" \
    --provisioning-model=SPOT \
    --instance-termination-action=STOP \
    --maintenance-policy=TERMINATE \
    --no-restart-on-failure

echo ">> 正在重新启动 Spot 虚拟机..."
gcloud compute instances start "$INSTANCE_NAME" --zone="$ZONE" --project="$PROJECT_ID" --quiet

echo "=========================================================="
echo "🎉 恭喜！Spot 降配与自动化开机插件已全部配置完毕！"
echo "1. 机器规格：e2-standard-2 (2核 8G) Spot 现货"
echo "2. 月费开销：由原 ~$109/月 骤降至 ~$16/月 (立省 85%)"
echo "3. 自动化看门狗：已激活 Cloud Workflows + Cloud Scheduler (每 3 分钟智能探活)"
echo "4. 一旦被 Google 抢占，云端看门狗将在 3 分钟内自动开机拉起服务！"
echo "=========================================================="
