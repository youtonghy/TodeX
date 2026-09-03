# TodeX 移动端应用 (`TodeX_app`)

<p align="center">
  <strong>基于 React Native、Expo SDK 57 与 HeroUI Native 构建的跨平台 <code>todex-agentd</code> 移动客户端。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

## 概述

**TodeX Mobile App** 是 TodeX 生态的移动端客户端应用，用于连接 [`todex-agentd`](../TodeX_backend) 后端服务。开发者可以通过手机随时随地查看、调度并掌控 AI 编程助手（如 **Codex**、**ACP 2.0**、**Pi**、**Claude Code** 和 **Grok Build**）。

应用基于 **React Native 0.86**、**Expo SDK 57**、**Uniwind (Tailwind CSS v4)** 和 **HeroUI Native** 构建，提供丝滑的手势操作体验、摄像头扫码一键配对、流式打字机聊天时间线、交互式审批卡片以及后量子传输层安全加密。

---

## 核心特性

- **移动端沉浸式 Agent 交互**：
  - 流式打字机式会话时间线，支持自动跟随与一键直达底部。
  - 针对命令行执行、代码变更对比、工具调用及提权操作的交互式审批卡片。
  - 智能输入联想建议：
    - 输入 `@`：直接从后端沙箱索引并选择工作区文件和目录。
    - 输入 `/`：联想并选择内置命令与 Agent 专属斜杠命令。
    - 输入 `#`：快速过滤并附加当前 Agent 启用的 Skills 和 MCP Servers。
- **工作区与会话生命周期管理**：
  - 工作区管理：在后端授权的沙箱根目录下创建、重命名、Fork 与删除项目工作区。
  - 多轮会话管理：会话独立保存在会话目录中，并在创建时锁定指定 Agent Provider（Codex CLI、ACP Profile、Pi、Claude Code、Grok Build）。
- **摄像头扫码与一键配对**：
  - 内置相机扫码器（`expo-camera`），扫描后端 TUI 终端生成的二维码即可秒级完成配对。
  - 支持多帧分片二维码重组还原算法，轻松应对高密度凭据传输。
  - 自动导入服务器地址、端口、认证 Token 及传输加密公钥。
- **能力中心与 Skill 注入**：
  - 专属 Capabilities 视图，集中浏览当前生效的 Skills 和 MCP Servers。
  - 支持在发送消息时附加指定 Skill（由后端通过 `resourceId` 自动注入，手机无需上传完整文件）。
- **高可用传输与后量子加密**：
  - 多路复用实时 WebSocket 客户端，直连后端 `/v2/ws`。
  - 主动心跳探测保活，支持指数退避自动重连（2s → 30s）。
  - 基于序列号的增量日志重放机制（`afterSequence`），无缝应对移动网络环境切换。
  - 端到端会话加密：集成 `@noble` 密码学套件，支持 **X25519** 与 **ML-KEM-768**（后量子密码学标准）。
- **安全本地持久化**：
  - 原生平台使用 `expo-secure-store` 安全存储敏感 Token 与公私钥，结合 `AsyncStorage` 缓存本地配置。

---

## 技术架构

| 模块分层 | 采用技术 |
| :--- | :--- |
| **基础运行时** | [React Native 0.86](https://reactnative.dev/) & [Expo SDK 57](https://expo.dev/) |
| **UI 与样式库** | [HeroUI Native](https://heroui-native.com/) & [Uniwind](https://github.com/uniwind/uniwind) (Tailwind CSS v4) |
| **导航与动效** | React Navigation v7, React Native Gesture Handler, Reanimated 4, Gorhom Bottom Sheet |
| **设备与传感器** | Expo Camera, Document Picker, Image Picker, Clipboard, SecureStore |
| **密码学套件** | `@noble/ciphers`, `@noble/curves`, `@noble/hashes`, `@noble/post-quantum` |
| **协议层核心** | 共享 `src/lib`（v2 API Client、Transport 传输层、Crypto 密码学模块、网络探测） |

移动端页面统一由 `src/navigation/AppNavigator.tsx` 静态注册。跨页面共享数据通过
`src/runtime` 中的外部 store 按实体或会话订阅，页面动作通过稳定的运行时代理调用；不要把
高频草稿、流式状态或终端输出重新提升到 `App.tsx` 的导航渲染树。持续增长的输出必须使用
虚拟化列表，并在进入 React 渲染层前设置明确的条目或字节上限。

---

## 快速开始

### 前置要求

- Node.js 22+
- npm 或 pnpm 工具
- 正在运行的 [`todex-agentd`](../TodeX_backend) 后端服务
- 手机端安装有 **Expo Go** 应用（或电脑配置有 iOS 模拟器 / Android 模拟器）

### 1. 安装依赖

```bash
cd TodeX_app
npm install
```

使用 Expo Doctor 检查依赖版本一致性：

```bash
npx expo install --check
npx expo-doctor
```

### 2. 启动开发服务器

#### 局域网模式（推荐：用于连接同一 Wi-Fi 下的物理手机）

```bash
npm run start
```

在终端输出的二维码出现后，Android 用户使用 **Expo Go** 扫码，iOS 用户使用系统**相机**扫码打开。

#### 本地模式（用于模拟器或桌面端 Web 调试）

```bash
npm run start:localhost
```

#### 隧道模式（当网络环境受限、路由器阻止局域网设备互通时）

```bash
npm run start:tunnel
```

### 3. 运行原生构建或模拟器

```bash
# 启动 iOS 模拟器
npm run ios

# 启动 Android 模拟器
npm run android

# 在网页浏览器中调试
npm run web
```

---

## 使用指南

1. **启动后端服务**：启动 `todex-agentd`（例如使用 `cargo run -- tui` 或 `cargo run -- serve --host 0.0.0.0`）。
2. **移动端配对**：
   - 打开 TodeX App，进入**设置（Settings）**页面。
   - 点击右上角扫码图标，扫描后端 TUI 终端显示的二维码。
   - *或者手动输入局域网地址（如 `http://192.168.1.100:7345`）及认证 Token。*
3. **选择工作区**：在授权的根目录下创建或切换项目工作区。
4. **开启对话**：点击 `+ 新建对话`，选择所需的 Agent Provider，即可开始对话。
5. **高效交互**：
   - 输入 `@` 快速检索工作区文件。
   - 输入 `/` 调出内置命令。
   - 输入 `#` 附加 Skill 或 MCP 工具。
   - 当 Agent 发起高危命令或工具调用时，在弹出的审批卡片中点击同意或拒绝。

---

## 支持的常用命令

App 内置支持并可自动路由以下常见斜杠命令：

| 分类 | 命令列表 |
| :--- | :--- |
| **模型与性能** | `/model`, `/fast` |
| **Agent 配置** | `/permissions`, `/personality`, `/plan`, `/goal`, `/compact`, `/review` |
| **能力与扩展** | `/skills`, `/hooks`, `/mcp`, `/subagents`, `/feedback` |
| **会话与进程控制** | `/start`, `/status`, `/attach`, `/interrupt`, `/stop` |
| **工作区与 Git** | `/new`, `/rename`, `/diff`, `/init` |

---

## 开发与测试

```bash
# 执行 TypeScript 类型检查
npm run typecheck

# 运行单元测试套件
npm run test

# 验证通信协议序列化与兼容性
npm run check:protocol
```

## Android 发布

Android APK 通过 **Actions > Release Android APK** 手动发布。输入 `1.2.3`
这样的稳定语义版本后，工作流会先验证应用，再在 GitHub Runner 上执行
EAS 本地构建，最后把 APK 和 SHA-256 校验文件发布到 `v1.2.3` GitHub Release。
Android 内部版本号根据工作流运行序号分配，确保可以从旧 CI 安装包继续覆盖升级。

仓库必须配置 `EXPO_TOKEN` Actions Secret，关联的 Expo 项目也必须已经保存固定的
Android keystore。EAS 仅负责项目认证和读取托管签名凭据，编译不会使用 EAS 云端构建
服务。由于可安装到真机的 iOS 包需要 Apple 签名证书和 Provisioning Profile，本流程
不构建 iOS IPA。

---

## 网络连接注意事项

- **真机连接**：手机真机连接电脑上的 `todex-agentd` 时，切勿填写 `127.0.0.1`（这只代表手机本地自身）。请使用电脑在局域网中的真实 IP（例如 `http://192.168.1.50:7345`）。
- **后端监听**：确保 `todex-agentd` 启动时监听了 `0.0.0.0` 或指定的局域网网卡。
- **系统防火墙**：确认 macOS / Linux 防火墙允许入站连接（后端默认端口 `7345`，Expo 默认端口 `8081`）。

---

## 相关仓库

- **[TodeX 后端服务](../TodeX_backend)**：基于 Rust 构建的后端守护进程 (`todex-agentd`)。
- **[TodeX 桌面端](../TodeX_desktop)**：基于 Electron 和 React 19 的 macOS 桌面客户端。

---

## 开源协议

本项目采用 MIT 许可证 - 详情参见 [LICENSE](LICENSE) 文件。
