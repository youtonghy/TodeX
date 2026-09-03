# TodeX Mobile App (`TodeX_app`)

<p align="center">
  <strong>Cross-platform mobile client for <code>todex-agentd</code> built with React Native, Expo SDK 57, and HeroUI Native.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

## Overview

**TodeX Mobile App** is the mobile client for the TodeX ecosystem, connecting to [`todex-agentd`](../TodeX_backend) to let developers monitor, steer, and interact with AI coding assistants (such as **Codex**, **ACP 2.0**, **Pi**, **Claude Code**, and **Grok Build**) directly from their iOS, Android, or mobile web devices.

Built with **React Native 0.86**, **Expo SDK 57**, **Uniwind (Tailwind CSS v4)**, and **HeroUI Native**, the app delivers fluid gesture navigation, in-camera QR code pairing, real-time streaming chat, interactive approval cards, and post-quantum encrypted transport.

---

## Key Features

- **Mobile-First Agent Chat**:
  - Full streaming conversation timeline with auto-scroll and jump-to-latest button.
  - Interactive approval cards for shell commands, file modifications, tool calls, and permission elevation.
  - Rich mention auto-complete:
    - `@` retrieves workspace files and directories directly from the backend sandbox.
    - `/` suggests built-in and provider slash commands.
    - `#` filters active Skills and MCP servers.
- **Workspace & Conversation Lifecycle**:
  - Manage workspaces: create, rename, fork, and delete directories within the backend sandbox.
  - Multi-turn conversation management: lock each conversation to a specific agent provider (Codex CLI, ACP profile, Pi, Claude Code, or Grok Build).
- **Camera Pairing & Instant Configuration**:
  - Integrated camera QR scanner (`expo-camera`) to pair with the `todex-agentd` TUI in seconds.
  - Robust multi-frame segmented QR reconstruction to handle dense payload transfers.
  - Automatic importation of host address, port, auth token, and encryption public keys.
- **Capabilities & Skill Injection**:
  - Dedicated Capabilities view to inspect active Skills and MCP servers.
  - Attach Skills to prompt turns (injected by backend via `resourceId` without uploading full files).
- **Robust Transport & Cryptography**:
  - Multiplexed real-time WebSocket client connected to `/v2/ws`.
  - Active heartbeat monitoring and automatic reconnection with exponential backoff (2s → 30s).
  - Sequence-based journal catch-up (`afterSequence`) to avoid message loss during network switches.
  - End-to-end transport encryption supporting **X25519** and **ML-KEM-768** (Post-Quantum) via the `@noble` cryptography suite.
- **Secure Local Storage**:
  - Employs `expo-secure-store` on native platforms for encrypted token and key persistence, combined with `AsyncStorage` for local caches.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | [React Native 0.86](https://reactnative.dev/) & [Expo SDK 57](https://expo.dev/) |
| **UI & Styling** | [HeroUI Native](https://heroui-native.com/) & [Uniwind](https://github.com/uniwind/uniwind) (Tailwind CSS v4) |
| **Navigation & Motion** | React Navigation v7, React Native Gesture Handler, Reanimated 4, Gorhom Bottom Sheet |
| **Hardware & Native** | Expo Camera, Document Picker, Image Picker, Clipboard, SecureStore |
| **Cryptography** | `@noble/ciphers`, `@noble/curves`, `@noble/hashes`, `@noble/post-quantum` |
| **Protocol Layer** | Shared `src/lib` implementation (v2 API Client, Transport, Crypto, Metrics) |

Mobile screens are registered statically in `src/navigation/AppNavigator.tsx`. Shared
screen data is subscribed through the entity- and conversation-scoped external stores
in `src/runtime`, while commands cross the boundary through stable runtime action
facades. Do not lift high-frequency drafts, streaming state, or terminal output back
into the `App.tsx` navigation render tree. Growing output must use virtualized lists and
an explicit entry or byte limit before it reaches React rendering.

The runtime-owned connection controller is the single owner of the `/v2/ws` socket,
transport encryption, reconnect policy, and health polling. Screens subscribe only to
the connection fields they display. Global prompts and sheets are rendered by
`AppOverlayHost`; app-level workflows open them through the overlay store and stable
action facade instead of adding modal state to `App.tsx`.

---

## Quick Start

### Prerequisites

- Node.js 22+
- npm
- Running instance of [`todex-agentd`](../TodeX_backend)
- Expo Go on your mobile device (or iOS Simulator / Android Emulator)

### 1. Install Dependencies

```bash
cd TodeX_app
npm install
```

HeroUI Native Pro distributes its component sources through an authenticated
installer. On a fresh machine, authenticate and fetch those artifacts before
running the checks or native builds:

```bash
npx heroui-pro login
npx heroui-pro install
```

CI performs the equivalent non-interactive setup with the `HEROUI_KEY` secret.
The downloaded Pro sources stay in `node_modules` and must not be committed.

Verify dependency alignment with Expo Doctor:

```bash
npx expo install --check
npx expo-doctor
```

### 2. Start the Development Server

#### LAN Mode (Recommended for physical devices on the same Wi-Fi)

```bash
npm run start
```

Scan the printed QR code using the **Expo Go** app (Android) or **Camera** app (iOS).

#### Localhost Mode (For simulators or desktop web testing)

```bash
npm run start:localhost
```

#### Tunnel Mode (When LAN discovery is restricted by firewall/NAT)

```bash
npm run start:tunnel
```

### 3. Native Platform Builds & Simulators

```bash
# Run on iOS Simulator (generates iOS native build)
npm run ios

# Run on Android Emulator
npm run android

# Run in Web Browser
npm run web
```

---

## Usage Guide

1. **Start the Backend**: Start `todex-agentd` (e.g., `cargo run -- tui` or `cargo run -- serve --host 0.0.0.0`).
2. **Pair Mobile Client**:
   - Open TodeX App and navigate to **Settings**.
   - Tap the QR Scanner icon and scan the pairing QR displayed in the backend TUI.
   - *Alternatively, manually input the backend URL (e.g., `http://192.168.1.100:7345`) and Bearer Token.*
3. **Select Workspace**: Create or choose a workspace directory within the authorized root.
4. **Start a Conversation**: Tap `+ New Conversation`, select the desired AI agent, and begin prompting.
5. **Interactive Controls**:
   - Type `@` to select files from the backend workspace.
   - Type `/` to pick slash commands.
   - Type `#` to attach Skills or MCP tools.
   - Respond to interactive approval cards when the agent requests permissions or tool executions.

---

## Supported Slash Commands

The app recognizes and routes these built-in commands:

| Command Category | Commands |
| :--- | :--- |
| **Model & Performance** | `/model`, `/fast` |
| **Agent Configuration** | `/permissions`, `/personality`, `/plan`, `/goal`, `/compact`, `/review` |
| **Capabilities** | `/skills`, `/hooks`, `/mcp`, `/subagents`, `/feedback` |
| **Session Control** | `/start`, `/status`, `/attach`, `/interrupt`, `/stop` |
| **Workspace & Git** | `/new`, `/rename`, `/diff`, `/init` |

---

## Development & Testing

```bash
# Typecheck TypeScript files
npm run typecheck

# Run unit test suite
npm run test

# Validate protocol serialization & compatibility
npm run check:protocol
```

## Android Releases

Android APK releases are created manually from **Actions > Release Android APK**.
Enter a stable semantic version such as `1.2.3`; the workflow validates the app,
runs EAS Build locally on the GitHub runner, and publishes the APK plus its SHA-256
checksum to the `v1.2.3` GitHub Release. Android's internal version code is assigned
from the workflow run number so releases remain upgradeable from older CI builds.

The repository must define an `EXPO_TOKEN` Actions secret, and the linked Expo
project must already have a permanent Android keystore. EAS is used for project
authentication and managed credential retrieval; compilation does not run on the
EAS cloud build service. The workflow does not build iOS because installable iOS
device packages require Apple signing credentials and a provisioning profile.

---

## Network & Connection Notes

- **Physical Device Testing**: When connecting a physical phone to `todex-agentd`, do not use `127.0.0.1` (which refers to the phone itself). Use your development machine's LAN IP (e.g. `http://192.168.1.50:7345`).
- **Backend Binding**: Ensure `todex-agentd` is listening on `0.0.0.0` or your LAN IP.
- **Firewall**: Ensure the macOS/Linux firewall allows incoming connections on the backend port (default `7345`) and Metro bundler port (default `8081`).

---

## Related Repositories

- **[TodeX Backend](../TodeX_backend)**: Rust backend daemon (`todex-agentd`).
- **[TodeX Desktop](../TodeX_desktop)**: Electron & React 19 desktop client.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
