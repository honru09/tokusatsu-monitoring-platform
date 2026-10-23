from pathlib import Path
p=Path('work/editorial-upgrade/resale-map.md')
s=p.read_text(encoding='utf-8')
s=s.replace('待浏览器构建','PASS · 定向浏览器夹具 / 只读渲染')
for prefix, note in {
    '| 上架管理 |': 'PASS · 查询/状态/批量/编辑；分页逻辑保留，本轮未实际翻页',
    '| 收录本页 |': '入口与 API 保留；本轮验证单件收录，未执行页面批量收录',
    '| 货源监测设置 |': '原回调保留；未跳转外层监测配置',
    '| 新建 / 编辑 / 扫描 / 暂停监测 |': 'PASS · 条件保存/脏稿/能力禁用；未启动真实自动扫描',
    '| 整理 / 接管 / 审核 / 核查 / 排队 / 暂停 |': 'PASS · 审核/定时/暂停；其余原 actions 回调保留',
    '| 操作历史 |': 'PASS · 编辑读取 events 夹具；真实历史只读可达',
}.items():
    lines=[]
    for line in s.splitlines():
        if line.startswith(prefix):
            parts=line.split('|')
            parts[-2]=f' {note} '
            line='|'.join(parts)
        lines.append(line)
    s='\n'.join(lines)+'\n'
s=s.replace('桌面无选中商品时是两列紧凑图文行','桌面无选中商品时是两列紧凑图文行')
s=s.replace('| 展开 | 原生 details，关联内容进入同一阅读流 | open 属性 | 相同功能 |', '| 展开 | 原生 details；支持 interpolate-size 的浏览器提供 180ms 局部高度/透明度过渡 | open 属性，可中途逆转 | 即时展开，相同功能 |\n| 图片横向阅读 | 原生 x proximity scroll-snap，仅96–120px缩略图strip | 手动滚动、点击和键盘选择，浏览器保持水平位置 | 原生吸附，不自动运动 |')
s += '''
## 2026-10-09 实際验证

隔离预览：`http://127.0.0.1:3105`，public API 使用同源 `/backend`。

- `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`：通过。
- `playwright-tests/resale-workspace.cjs`：1440 / 390 / 320 通过，含登录/失效、失败保存、编辑/预览/图片、默认/逐商品运费、prepare先保存返回版本、URL回填、菜单键盘与工作区保留、审核/暂停、触点无遮挡。
- `playwright-tests/resale-operations.cjs`：1440 / 390 通过，含批量部分成功/定时、监测保存/导入/已读、未连接操作禁用、人工调价回执、真实ID维护→数据→返回商品、两件商品逐件输入恢复、未知与0、排序/区间/CSV。
- `playwright-tests/resale-ai-flow.cjs`：1440 / 390 通过，含采购详情关联、读取结果复用、仅点击翻译、无自动AI、额度到聊天无页面刷新、聊天发送。
- `playwright-tests/resale-connected-flow.cjs`：1440 / 390 / 320（短屏568高）通过，含收录失败保留、主集合与货源筛选独立、真实新listingId选中、脏稿切换保护、来源查询恢复、Escape/焦点/滚动恢复、9图原生横向snap与键盘选择/水平滚动。
- `work/editorial-upgrade/resale-visual.cjs`：禁止全部非GET，在真实商品上检查320 / 390 / 768 / 1280 / 1440：列表→编辑、44px控件、无横向溢出、无pageerror均通过。
- 截图：`work/editorial-upgrade/resale-{list,editor}-{320,390,768,1280,1440}.png`；流程截图：`playwright-artifacts/resale/`。
- 图片吸附只用于横向缩略图；主商品集合、运营表格、整个编辑器与工具抽屉不强制吸附。

读写真正的数据边界：全部浏览器业务流程 mutation 使用夹具；只读真实视觉脚本拦截非GET。此次未发出实际AI/发布/采购/付款/交易请求。最终生产构建与全站验收由主代理统一执行。
'''
p.write_text(s,encoding='utf-8')
