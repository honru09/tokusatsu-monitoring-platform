# 运营台使用与部署

入口：工作台 → 运营台，或 `/?workspace=operations`。独立窗口为 `/operations-browser/`。

## 登录

本机 `.private-operations/Operations-Accounts.txt` 包含龙（long）、润（run）的专用运营密码。它们不是小红书/抖音密码。文件已忽略Git和Docker构建上下文，Windows目录仅授权当前用户与SYSTEM。请分别私下分发，勿放入公开消息。

运营网关使用scrypt散列、7天服务端会话及HttpOnly/Secure/SameSite cookie。重启不清空有效运营会话；退出会使自己的会话与控制连接失效。平台账号首次登录需本人扫码/短信验证，后续是否再次验证由平台决定。

## 平台与素材

- 小红书、抖音各自的真实Chromium浏览器和用户资料目录在D盘 `data/operations/<platform>/chromium`。
- 同一平台仅一人控制；切换平台/关闭页面/结束控制释放控制权，不清除平台Cookie。
- 素材分块上传，单文件2GB，单平台素材库10GB；文件仅进入对应平台的 `/materials` 目录。在远程浏览器的文件选择器中打开该目录即可选择素材。
- 不自动发布内容、不自动发送平台短信、不处理验证码；未在真实账号下测试发布流程。
- 视频画面可经VNC查看，但此版本不提供远程音频传输；剪辑/声音核对建议在本地完成。
- 中文输入区提供剪贴板粘贴和Unicode逐字输入；不会自动读取本地剪贴板。平台或输入法仍可能限制输入。
- 使用这台电脑当前网络，不保证固定IP或东京地理归属。电脑/Docker必须运行。

## 启停与更新

初始化/启动：运行 `scripts/start-operations.ps1`，不会覆盖已有账号和浏览器资料。

构建全部运营镜像：
```powershell
docker compose --env-file .env -f infrastructure/docker-compose.yml --profile operations build ops-gateway ops-xiaohongshu ops-douyin ops-egress web
docker compose --env-file .env -f infrastructure/docker-compose.yml --profile operations up -d ops-egress ops-xiaohongshu ops-douyin ops-gateway web gateway
```

Web现由gateway统一绑定127.0.0.1:3000。不要再单独将web映射到主机3000，否则与入口冲突。更新ops-gateway镜像后也应重建gateway，因为两者复用同一个镜像但运行不同进程。

两个浏览器固定容器hostname，避免容器重新创建引起Chromium的跨设备资料锁误判。若确有资料锁异常，先确认对应浏览器全部停止；只清理过期SingletonLock/SingletonSocket/SingletonCookie，不删除用户资料。首次从随机hostname迁移时已验证旧实例停止后进行过一次锁文件清理。

## 安全边界

无VNC/代理公网端口；浏览器在internal网络，仅经Squid访问公网80/443。私网、localhost、云metadata被拒绝；TLS不解密。浏览器不挂载Keys、宿主桌面、源码或Docker socket。所有素材/API/WS受运营认证保护；浏览器Cookie不送给前端或AI。

认证不是平台免验证能力。MFA、验证码、登录风控必须人工处理，不绕过。当前为两位可信运营者共享官方账号环境，不适合作为不可信第三方的通用云桌面。

保留数据请备份 `.private-operations` 与 `data/operations`，备份也属于敏感信息，禁止上传公开仓库。
