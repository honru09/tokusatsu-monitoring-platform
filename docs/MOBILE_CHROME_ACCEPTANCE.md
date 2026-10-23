# 操作层与闲鱼状态验收

- 33 个 Web 测试文件、162 项测试通过；Next.js生产编译、类型检查和Docker构建通过。
- 浏览器触摸事件（CDP）验证历史与砍价都可拖动、贴边，刷新后位置保持；拖动不误开菜单。
- 320/390/430px手机：底栏left0、宽度等于屏幕、bottom844（测试视口高844），下方缝隙0；1440px桌面仍为居中悬浮导航。
- 普通状态输入框在底栏上方；模拟键盘visualViewport变为460px后输入框留在可见区域，底栏暂隐；恢复后bottom回到844。手机Enter换行，不发送测试消息。
- 键盘验证是浏览器模拟，不声称已在实体iOS/Android键盘上验证。
- 首页入口副说明与顶栏重复状态移除；用户采购备注与聊天记录不删除。
- 闲鱼：实际部署开关关闭、Provider未配，独立队列无调度/无任务，比较与机会表均无记录。开启条件见 XIANYU_ENABLEMENT_STATUS.md。未擅自启用计费任务。
- 旧临时域名已失效，启动隐藏cloudflared进程重新建立临时链接： https://equipped-sur-mason-webcast.trycloudflare.com/ 。

截图在 `.impeccable/review/mobile-chrome/`，设计扫描仅有少量色阶/圆角建议。
