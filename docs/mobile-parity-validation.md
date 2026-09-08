# 移动端功能对齐与验收记录

日期：2026-09-08。范围：TodeX_app；以现有 desktop 行为和后端协议为依据，不修改 desktop/backend 的独立工作。

## 功能与实现

| 范围 | 本次实现 | 验证方式 |
| --- | --- | --- |
| v2 发送 | 请求 ID 关联确认、失败保留草稿、超时/断线标记未知；核对后使用原 ID 显式重试 | commands/recovery 单测 |
| 附件 | 图片与文本附件加入实际 prompt；不支持或损坏内容在清空草稿前拒绝 | 附件单测、类型检查 |
| 实时控制 | capability gate、纠偏、当前回合配置、Agent 队列增删查清；本机待发恢复与继续 | 协议结构与 reducer 单测 |
| 恢复 | 单飞 REST 回放、连续序号、去重、断线重连订阅、Backend 切换隔离 | 乱序、重试、重置、旧 turn 单测 |
| 聊天布局 | 基于聊天容器宽度布局；740px 起双栏；分隔拖拽与旋转约束；保留聊天实例 | split-layout 单测 |
| Markdown | 标题、列表、引用、表格、代码块、链接和未闭合流式内容 | Markdown 单测 |
| 工作台 | 手机/iPad 复用文件、浏览器、终端、Diff；保留访问过的面板和独立目标 | 类型检查、代码路径检查 |
| 终端 | 离线 xterm WebView、PTY 原始输入输出、ANSI、窗口尺寸、多个会话 | 终端重放单测及 Chromium bridge smoke |
| Git | 分支、worktree 管理；PR/Handoff 指令入口不覆盖输入框草稿 | Git helper 单测、类型检查 |
| 能力与设置 | Skill 正文、MCP 刷新、CLI 管理页 | 类型检查及 API 路径对照 |

## 性能改动与证据边界

- v2 投影只 upsert 引用变化的时间线项，保留未变化消息对象，让 MessageBubble memo 生效。
- 控制状态订阅移到独立子组件；序号不再每个文本增量都写入会话元数据。
- 工具 API client memo 化；关闭或隐藏的终端停止尺寸上报，切换面板保留现有会话。
- HeroUI Pro 使用公开子路径导入，并在 Babel 中拆开其内部组件汇总导入，避免未使用的图表初始化。原始 Web 导出约 6.9 MB JS，最终主 bundle 约 4.9 MB（Expo 日志的未压缩、四舍五入体积；并非首屏下载或运行耗时指标）。
- 未测量真机 FPS、输入延迟、功耗、长会话峰值内存，不据此宣称达到某个帧率或提升百分比。

## 自动检查

- `npm run typecheck`
- `npm run test:unit`：160 项通过。
- `npm run check:protocol`
- `npm run build:terminal-assets`
- `npx expo export --platform web`
- `npx expo export --platform ios --platform android`
- `git diff --check`

Web Chromium 已验证 390×844 工作区首屏、关闭弹层不残留、更多菜单到设置页导航；未接入真实会话的数据流。

终端 Chromium smoke 覆盖 ANSI/回车覆盖、中文输入、Tab、Ctrl-C、20×60 resize。导出成功不等于已通过 iOS/Android 安装和真机交互验收。

## 仍需设备/服务验收

1. 真机手机与 iPad 横竖屏、分栏拖拽、键盘避让、后台恢复、长列表滚动。
2. 连接授权的 Backend/Agent，核对附件实际内容、权限弹窗、运行中控制和未知结果恢复。
3. 多终端前后台切换、中文输入法、WebView 剪贴板与长时输出。
4. 在测试仓库执行分支/worktree 写操作，以及 PR/Handoff 完整流程。
5. Web 仍可能出现第三方 `colorKit.RGB` 颜色回退日志；本地未授权 Backend 返回 401 不属于成功连接验收。Web 仅作为补充布局与启动 smoke，原生平台需上述设备验收。

Git/PR 操作由用户明确点击触发；网络错误后的 Git 写操作不会自动重试。
