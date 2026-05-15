# TodeX App / TodeX 客户端

TodeX App 是移动端客户端，用来连接 `todex-agentd`，管理工作区和对话，发送消息、处理审批，并查看 Codex 的运行状态。

TodeX App is the mobile client for connecting to `todex-agentd`, managing workspaces and conversations, sending messages, handling approvals, and monitoring Codex activity.

## 功能 / Features

- 工作区管理：新增、重命名、Fork、删除目录
- 对话管理：每个工作区下可创建多个对话
- 聊天界面：支持消息输入、历史时间线、跳到最新消息
- `@` 文件引用：从后端工作区目录中检索文件和目录建议
- `/` 命令：内置命令补全和命令路由，不是 shell 执行
- 审批处理：支持命令执行、权限、工具请求等审批卡片
- 运行控制：启动、状态、附加、中断、停止本地 Codex 会话
- 设置保存：连接地址、token、tenant、可选传输加密、默认目录、默认模型、权限和沙盒模式
- 配对连接：扫描后端 TUI 二维码，一键导入地址、端口、token 和 X25519/ML-KEM-768 公钥

- Workspace management: add, rename, fork, and delete directories
- Conversation management: multiple conversations per workspace
- Chat view: message input, timeline history, and jump-to-latest
- `@` file references: fetch file and directory suggestions from the backend
- `/` commands: built-in command completion and routing, not shell execution
- Approval handling: command, permission, and tool request cards
- Runtime controls: start, status, attach, interrupt, and stop local Codex sessions
- Settings persistence: server URL, token, tenant, optional transport encryption, default path, default model, approval policy, and sandbox mode
- Pairing connection: scan the backend TUI QR to import address, port, token, and X25519/ML-KEM-768 public keys

## 快速开始 / Quick Start

### 1. 安装依赖 / Install

```bash
npm install
```

### 2. 启动开发环境 / Start development

```bash
npm run start
```

`npm run start` 会以 LAN 模式启动 Expo，方便同一局域网内的真机从开发机加载应用；如果网络禁止局域网发现，可以改用 `npm run start:tunnel`。只在模拟器或本机浏览器调试时，可以用 `npm run start:localhost`。

`npm run start` starts Expo in LAN mode so physical devices on the same network can load the app from your development machine. If LAN discovery is blocked, use `npm run start:tunnel`. For simulator-only or local-browser development, use `npm run start:localhost`.

也可以直接启动目标平台：

```bash
npm run android
npm run ios
npm run web
```

You can also launch a target platform directly:

```bash
npm run android
npm run ios
npm run web
```

## 使用方式 / How to Use

1. 先启动 `TodeX_backend`。
2. 打开 App，在设置里扫描后端 TUI 的配对二维码，或手动填写后端地址和 `Auth token`。
3. 新建一个工作区，选择本地目录。
4. 进入对话，开始发送消息。
5. 输入 `@` 选择文件，输入 `/` 选择内置命令。

1. Start `TodeX_backend` first.
2. Open the app and set the backend URL and `Auth token`.
3. Create a workspace and choose a local directory.
4. Open a conversation and start sending messages.
5. Type `@` to pick files and `/` to choose built-in commands.

## 主要界面 / Main Screens

- 工作区列表 / Workspace list
- 对话列表 / Conversation list
- 聊天页 / Chat view
- 设置页 / Settings

## 常用命令 / Common Commands

App 会识别并路由这些常见命令：

- `/model`
- `/permissions` / `/permission`
- `/plan`
- `/goal`
- `/compact`
- `/review`
- `/skills`
- `/hooks`
- `/mcp`
- `/start`
- `/status`
- `/attach`
- `/interrupt`
- `/stop`
- `/new`
- `/rename`
- `/diff`
- `/init`

The app recognizes and routes these common commands:

- `/model`
- `/permissions` / `/permission`
- `/plan`
- `/goal`
- `/compact`
- `/review`
- `/skills`
- `/hooks`
- `/mcp`
- `/start`
- `/status`
- `/attach`
- `/interrupt`
- `/stop`
- `/new`
- `/rename`
- `/diff`
- `/init`

## 开发检查 / Development Checks

```bash
npm run typecheck
npm run check:protocol
```

## 本地存储 / Local Storage

App 会把设置、工作区、对话、时间线、mention 历史和 token 保存在本地；移动端非 web 环境下优先使用安全存储。

The app persists settings, workspaces, conversations, timeline data, mention history, and tokens locally; on non-web mobile builds it prefers secure storage.

## 连接信息 / Connection Notes

- 默认后端地址：`http://127.0.0.1:7345`
- 真机调试时不要使用 `127.0.0.1` 连接后端；在 App 设置里改成开发机的局域网地址，例如 `http://192.168.88.240:7345`
- 后端服务需要监听 `0.0.0.0` 或开发机的局域网地址，并确保 macOS 防火墙允许对应端口（Expo 默认 `8081`，后端默认 `7345`）
- 默认 tenant：`local`
- 默认目录：`/home/dev/projects`
- 默认模型：`gpt-5.5`
- 默认权限：`on-request`
- 默认沙盒：`workspace-write`

- Default backend URL: `http://127.0.0.1:7345`
- For physical device testing, do not use `127.0.0.1` for the backend; set the app to your development machine's LAN address, for example `http://192.168.88.240:7345`
- The backend must listen on `0.0.0.0` or the development machine's LAN address, and macOS Firewall must allow the relevant ports (Expo defaults to `8081`, backend defaults to `7345`)
- Default tenant: `local`
- Default workspace path: `/home/dev/projects`
- Default model: `gpt-5.5`
- Default approval policy: `on-request`
- Default sandbox: `workspace-write`
