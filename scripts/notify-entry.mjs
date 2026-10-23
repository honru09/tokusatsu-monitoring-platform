import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function sendEntryNotification(url, rootDir) {
  if (!url) return;

  const textContent = `=====================================================
假面特摄监控采购平台 - 最新公网访问地址
=====================================================
最新访问 URL: ${url}
更新时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}
状态: 在线就绪 (Ready)
=====================================================
`;
  try {
    await writeFile(join(rootDir, "LATEST_PUBLIC_URL.txt"), textContent, "utf8");
  } catch {}

  let envContent = "";
  try {
    envContent = await readFile(join(rootDir, ".env"), "utf8");
  } catch {}

  const getEnv = (key) => {
    if (process.env[key]) return process.env[key];
    const match = envContent.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  };

  const wecomWebhook = getEnv("WECOM_WEBHOOK_URL");
  const feishuWebhook = getEnv("FEISHU_WEBHOOK_URL");
  const dingtalkWebhook = getEnv("DINGTALK_WEBHOOK_URL");
  const serverChanKey = getEnv("SERVERCHAN_SENDKEY");
  const pushplusToken = getEnv("PUSHPLUS_TOKEN");
  const customWebhook = getEnv("NOTIFY_WEBHOOK_URL");

  const messageTitle = "🔔【假面采购】平台公网新地址已上线";
  const messageBody = `系统已恢复连接，最新公网访问地址：\n${url}\n更新时间：${new Date().toLocaleString("zh-CN")}`;

  const tasks = [];

  if (wecomWebhook) {
    tasks.push(
      fetch(wecomWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: {
            content: `${messageTitle}\n${messageBody}`,
          },
        }),
      }).catch(() => null)
    );
  }

  if (feishuWebhook) {
    tasks.push(
      fetch(feishuWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msg_type: "text",
          content: {
            text: `${messageTitle}\n${messageBody}`,
          },
        }),
      }).catch(() => null)
    );
  }

  if (dingtalkWebhook) {
    tasks.push(
      fetch(dingtalkWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: {
            content: `${messageTitle}\n${messageBody}`,
          },
        }),
      }).catch(() => null)
    );
  }

  if (serverChanKey) {
    tasks.push(
      fetch(`https://sctapi.ftqq.com/${serverChanKey}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "假面采购平台新地址上线",
          desp: `### 假面特摄采购平台最新访问地址\n\n**公网链接**：[${url}](${url})\n\n**更新时间**：${new Date().toLocaleString("zh-CN")}`,
        }),
      }).catch(() => null)
    );
  }

  if (pushplusToken) {
    tasks.push(
      fetch("https://www.pushplus.plus/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: pushplusToken,
          title: "假面采购平台新地址上线",
          content: `<h3>假面采购平台已上线</h3><p>最新地址：<a href="${url}">${url}</a></p><p>时间：${new Date().toLocaleString("zh-CN")}</p>`,
          template: "html",
        }),
      }).catch(() => null)
    );
  }

  if (customWebhook) {
    tasks.push(
      fetch(customWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "tunnel_ready",
          url,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => null)
    );
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}
