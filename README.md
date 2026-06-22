# LobsterAI — All-Scenario Office Assistant Agent

<p align="center">
  <img src="public/logo.png" alt="LobsterAI" width="120">
</p>

<p align="center">
  <strong>A 24/7 all-scenario office assistant Agent that gets real work done — built by NetEase Youdao</strong>
</p>

<p align="center">
  <em>The first open-source, desktop-grade Agent from a major Chinese tech company — publicly praised by OpenClaw's founder.</em>
</p>

<p align="center">
  <a href="https://github.com/netease-youdao/LobsterAI/stargazers"><img src="https://img.shields.io/github/stars/netease-youdao/LobsterAI?style=for-the-badge&logo=github&color=FFD43B" alt="GitHub stars"></a>
  <a href="https://github.com/netease-youdao/LobsterAI/releases"><img src="https://img.shields.io/github/v/release/netease-youdao/LobsterAI?style=for-the-badge&color=brightgreen" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <br>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-brightgreen?style=for-the-badge" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
</p>

<p align="center">
  <a href="https://github.com/netease-youdao/LobsterAI/releases"><strong>⬇️ Download</strong></a>
  &nbsp;·&nbsp;
  <a href="#community"><strong>💬 Community</strong></a>
  &nbsp;·&nbsp;
  <a href="https://www.star-history.com/#netease-youdao/LobsterAI&type=date"><strong>⭐ Star History</strong></a>
  &nbsp;·&nbsp;
  English · <a href="README_zh.md">中文</a>
</p>

---

**LobsterAI** is an all-scenario office assistant Agent built by [NetEase Youdao](https://www.youdao.com/) — the first open-source, desktop-grade Agent from a major Chinese tech company. It works around the clock to get real work done: data analysis, slide decks, video generation, document writing, web research, email, scheduled jobs, and more.

Unlike chat-only assistants, LobsterAI is **desktop-grade**. Through its **Cowork mode** it connects to your files, terminal, browser, and local projects — executing tools and running commands directly in your real working environment, with every sensitive action gated behind your approval. Spin up purpose-built Agents (stock research, content writing, lesson planning…), extend it with Expert Kits, Skills, and MCP servers, and reach it from your phone via WeChat, WeCom, DingTalk, Feishu, QQ, Telegram, Discord, and more — command your computer to work anytime, anywhere.

## Why LobsterAI

- **🔓 Open source, secure & trustworthy** — 100% open-source code with transparent capabilities; permissions, data, and execution flows are all auditable
- **🖥️ Desktop-grade Agent** — Connects to your files, terminal, browser, and local projects, working directly inside your real environment instead of a sandboxed chat box
- **🧩 OpenClaw ecosystem** — Built on the open-source OpenClaw Agent framework, with continuous access to new Skills, tools, MCP servers, and models
- **📱 Command your computer from your phone** — Drive LobsterAI 24/7 through WeChat, WeCom, DingTalk, Feishu, QQ, Telegram, Discord, and more
- **🔒 Local data, controlled actions** — Sessions, configuration, and memory stay on your device; every tool call is gated and logged

## Capabilities

- **All-scenario productivity** — Data analysis, PPT creation, video generation, document writing, web search, email — covering the full range of daily work
- **Custom Agents** — Create purpose-built Agents (e.g. Stock Expert, Content Writer, Lesson Planner) each with its own identity, skills, and IM channels
- **Expert Kits & Skills** — 28 built-in skills plus installable Expert Kits; build your own with `skill-creator` and hot-load at runtime
- **MCP support** — Connect external tools and data sources through Model Context Protocol servers
- **Scheduled tasks** — Create recurring jobs by conversation or GUI — daily news digests, inbox cleanup, periodic reports, and more
- **Persistent memory** — Remembers your preferences and context across sessions via file-based memory; gets smarter the more you use it
- **Local-first** — Run tasks directly on your machine
- **Cross-platform** — macOS (Intel + Apple Silicon) and Windows desktop, plus mobile reach via IM
- **Windows built-in Python runtime** — Windows packages bundle a ready-to-use Python interpreter; skill dependencies install on demand

## Real-World Scenarios

| Scenario | Example prompt |
|----------|---------------|
| **Build a full system from scratch** | "I run a small shop and still track stock and sales in Excel. Build me an inventory system: log purchases and sales, auto-calculate stock and profit, and let me open it locally." |
| **Edit files, process data, build pages** | "Using the data in `product-growth.xlsx`, build me a visualization page." |
| **Daily scheduled news digest** | "Every morning at 9, send me yesterday's AI news — especially OpenAI, Anthropic, Google and Chinese labs." |
| **Deep research & PPT generation** | "Research the global AI Agent market landscape, and turn `traffic-report.pdf` into a report deck." |
| **Browser automation** | "Open my ads dashboard every day, check whether spend, conversion, or cost-per-lead looks abnormal, and summarize the cause." |
| **Resume screening & doc review** | "Turn the 50 resumes in this folder into a screening sheet, flag anyone missing the JD's hard requirements, then shortlist the best 10." |
| **Keeps learning** | "From now on, keep every document you write for me clear, logical, and concise." — saved to long-term memory |

## How It Works

<p align="center">
  <img src="docs/res/architecture_v2_en.png" alt="Architecture" width="500">
</p>

## Quick Start

### Prerequisites

- **Node.js** >= 24 < 25
- **npm**

### 1. Clone & install

```bash
git clone https://github.com/netease-youdao/LobsterAI.git
cd LobsterAI
npm install
```

### 2. Start the app

> [!IMPORTANT]
> Cowork mode runs on the **OpenClaw** agent engine. The **first launch must build the OpenClaw runtime**, or Cowork sessions won't start. Use the `electron:dev:openclaw` command for the first run.

```bash
# First run: builds the OpenClaw runtime, then starts the app.
# Clones & builds OpenClaw on first run — this can take several minutes.
npm run electron:dev:openclaw
```

Once the runtime has been built, day-to-day development can use the faster command —
it reuses the existing runtime and skips the OpenClaw build step:

```bash
npm run electron:dev
```

The Vite dev server runs at `http://localhost:5175`. By default the app connects to
LobsterAI's **production** services, so no extra setup is needed to sign in and use it.

#### OpenClaw build options

The required OpenClaw version is pinned in `package.json` under `openclaw.version`, and
its source is cloned/managed at `../openclaw` (relative to this repo) by default.

```bash
# Use a custom OpenClaw source path
OPENCLAW_SRC=/path/to/openclaw npm run electron:dev:openclaw

# Force a rebuild even when the pinned version hasn't changed
OPENCLAW_FORCE_BUILD=1 npm run electron:dev:openclaw

# Skip the automatic version checkout (e.g. when developing OpenClaw locally)
OPENCLAW_SKIP_ENSURE=1 npm run electron:dev:openclaw
```

### Production Build

```bash
# TypeScript compilation + Vite bundle
npm run build

# ESLint check
npm run lint
```

## Packaging & Distribution

<details>
<summary>Build commands, channel packages, manual runtime build & Windows Python bundling</summary>

Uses [electron-builder](https://www.electron.build/) to produce platform-specific installers. Output goes to `release/`.

```bash
# macOS (.dmg)
npm run dist:mac

# macOS - Intel only
npm run dist:mac:x64

# macOS - Apple Silicon only
npm run dist:mac:arm64

# macOS - Universal (both architectures)
npm run dist:mac:universal

# Windows (.exe NSIS installer)
npm run dist:win

# Linux (.AppImage & .deb)
npm run dist:linux
```

Build channel-specific packages by setting `KEYFROM`:

```bash
# macOS - Intel only
KEYFROM=xxx npm run dist:mac:x64

# macOS - Apple Silicon only
KEYFROM=xxx npm run dist:mac:arm64

# Windows (.exe NSIS installer)
npx cross-env KEYFROM=xxx npm run dist:win
```

Desktop packaging (macOS / Windows / Linux) bundles a prebuilt OpenClaw runtime under `Resources/cfmind`.
The pinned OpenClaw version (`package.json` → `openclaw.version`) is automatically fetched and built during packaging — no manual setup needed.
The build is cached: if the runtime for the pinned version already exists locally, the build step is skipped automatically.

You can also build OpenClaw runtime manually:

```bash
# Build runtime for current host platform (auto-detect mac/win/linux + arch)
npm run openclaw:runtime:host

# Build explicit targets
npm run openclaw:runtime:mac-arm64
npm run openclaw:runtime:mac-x64
npm run openclaw:runtime:win-x64
npm run openclaw:runtime:linux-x64
```

Override OpenClaw source path with an environment variable when needed:

```bash
OPENCLAW_SRC=/path/to/openclaw npm run dist:win
```

Windows builds bundle a portable Python runtime under `resources/python-win` (included as installer resource `python-win`), so end users do not need to install Python manually.
The bundled runtime is interpreter-focused and does not preinstall LobsterAI skill Python packages; those can be installed at runtime on demand.
By default, packaging downloads the official Python embeddable runtime from python.org if no prebuilt archive is provided.
For offline/non-network builds, provide a prebuilt runtime archive explicitly.

Offline/runtime source options for packaging:
- `LOBSTERAI_PORTABLE_PYTHON_ARCHIVE`: Local prebuilt runtime archive path (recommended for offline CI/CD)
- `LOBSTERAI_PORTABLE_PYTHON_URL`: Download URL for the prebuilt runtime archive
- `LOBSTERAI_WINDOWS_EMBED_PYTHON_VERSION` / `LOBSTERAI_WINDOWS_EMBED_PYTHON_URL` / `LOBSTERAI_WINDOWS_GET_PIP_URL`: Optional overrides for Windows-host bootstrap sources

</details>

## Architecture

LobsterAI uses Electron's strict process isolation. All cross-process communication goes through IPC.

### Process Model

**Main Process** (`src/main/main.ts`):
- Window lifecycle management
- SQLite persistence
- OpenClaw agent engine (primary) + CoworkEngineRouter dispatch layer
- IM Gateways — WeChat, WeCom, DingTalk, Feishu, QQ, Telegram, Discord, POPO remote access
- 40+ IPC channel handlers
- Security: context isolation enabled, node integration disabled, sandbox enabled

**Preload Script** (`src/main/preload.ts`):
- Exposes `window.electron` API via `contextBridge`
- Includes `cowork` namespace for session management and stream events

**Renderer Process** (`src/renderer/`):
- React 18 + Redux Toolkit + Tailwind CSS
- All UI and business logic
- Communicates with main process exclusively through IPC

### Directory Structure

<details>
<summary>View the full source tree</summary>

```
src/
├── main/                           # Electron main process
│   ├── main.ts                     # Entry point, IPC handlers
│   ├── preload.ts                  # Security bridge
│   ├── sqliteStore.ts              # SQLite storage
│   ├── coworkStore.ts              # Session/message CRUD
│   ├── skillManager.ts             # Skill management
│   ├── im/                         # IM gateways (WeChat/WeCom/DingTalk/Feishu/QQ/Telegram/Discord/POPO)
│   └── libs/
│       ├── agentEngine/
│       │   ├── coworkEngineRouter.ts    # Dispatch layer (routes sessions to the active engine)
│       │   ├── openclawRuntimeAdapter.ts # Primary OpenClaw gateway adapter
│       │   └── claudeRuntimeAdapter.ts  # Legacy built-in adapter (deprecated)
│       ├── coworkRunner.ts          # Legacy built-in executor (deprecated)
│       ├── openclawEngineManager.ts # OpenClaw runtime lifecycle (install/start/status)
│       ├── openclawConfigSync.ts    # Syncs cowork config → OpenClaw config files
│       └── coworkMemoryExtractor.ts # Memory extraction
│
├── renderer/                        # React frontend
│   ├── App.tsx                     # Root component
│   ├── types/                      # TypeScript definitions
│   ├── store/slices/               # Redux state slices
│   ├── services/                   # Business logic (API/IPC/i18n)
│   └── components/
│       ├── cowork/                 # Cowork UI components
│       ├── artifacts/              # Artifact renderers
│       ├── skills/                 # Skill management UI
│       ├── im/                     # IM integration UI
│       └── Settings.tsx            # Settings panel
│
SKILLs/                              # Skill definitions
├── skills.config.json              # Skill enable/disable and ordering
├── web-search/                     # Web search
├── docx/                           # Word document generation
├── xlsx/                           # Excel spreadsheets
├── pptx/                           # PowerPoint presentations
├── pdf/                            # PDF processing
├── remotion/                       # Video generation
├── playwright/                     # Web automation
└── ...                             # More skills
```

</details>

## Cowork System

Cowork is the core feature of LobsterAI — an AI working session system powered by OpenClaw as the primary agent engine. Designed for productivity scenarios, it can autonomously complete complex tasks like data analysis, document generation, and information retrieval.

<details>
<summary>Execution modes, stream events & permission control</summary>

### Execution Modes

| Mode | Description |
|------|-------------|
| `auto` | Automatically selects based on context |
| `local` | Direct local execution, full speed |

### Stream Events

Cowork uses IPC events for real-time bidirectional communication:

- `message` — New message added to the session
- `messageUpdate` — Incremental streaming content update
- `permissionRequest` — Tool execution requires user approval
- `complete` — Session execution finished
- `error` — Execution error occurred

### Permission Control

All tool invocations involving file system access, terminal commands, or network requests require explicit user approval in the `CoworkPermissionModal`. Both single-use and session-level approvals are supported.

</details>

## Skills System

LobsterAI ships with a rich set of built-in skills covering productivity, creative, investment research, and automation scenarios, configured via `SKILLs/skills.config.json`. Below are some typical examples:

<details>
<summary>View the full skill list</summary>

| Skill | Function | Typical Use Case |
|-------|----------|-----------------|
| web-search | Web search | Information retrieval, research |
| docx | Word document generation | Reports, proposals |
| xlsx | Excel spreadsheet generation | Data analysis, dashboards |
| pptx | PowerPoint creation | Presentations, business reviews |
| pdf | PDF processing | Document parsing, format conversion |
| remotion | Video generation (Remotion) | Promo videos, data visualization animations |
| seedance | AI video generation (Seedance) | Text-to-video, image-to-video |
| seedream | AI image generation (Seedream) | Text-to-image, image editing and fusion |
| playwright | Web automation | Browser tasks, automated testing |
| canvas-design | Canvas drawing and design | Posters, chart design |
| frontend-design | Frontend UI design | Prototyping, page design |
| develop-web-game | Web game development | Quick game prototypes |
| stock-analyzer | Stock deep analysis | A-share research, valuation and financials |
| stock-announcements | Stock announcement retrieval | Listed company filings, disclosure lookup |
| stock-explorer | Stock information explorer | Basic stock info, market overview |
| content-planner | Content planning | Topic strategy, content calendar creation |
| article-writer | Article writing | Multi-style long-form content, social media posts |
| daily-trending | Daily trending | Hot topic aggregation, trend tracking |
| films-search | Film/TV resource search | Movie and series cloud-drive download links |
| music-search | Music resource search | Song and album cloud-drive download links |
| technology-news-search | Tech news search | Programming, AI, and IT industry updates (disabled by default) |
| weather | Weather queries | Weather information |
| local-tools | Local system tools | File management, system operations |
| imap-smtp-email | Email send/receive | Email processing, auto-replies |
| create-plan | Plan authoring | Project planning, task breakdown |
| youdaonote | Youdao Note | Note management, to-dos, web clipping |
| skill-vetter | Skill security audit | Safety check before installing third-party skills |
| skill-creator | Custom skill creation | Extend new capabilities |

</details>

Custom skills can be created via `skill-creator` and hot-loaded at runtime.

## Scheduled Tasks

LobsterAI supports scheduled tasks that let the Agent automatically execute recurring work on a set schedule.

### How to Create

- **Conversational** — Tell the Agent in natural language (e.g., "collect tech news for me every morning at 9 AM"), and it will create the scheduled task automatically
- **GUI** — Add tasks manually in the Scheduled Tasks management panel with a visual interface for configuring timing and task content

### Typical Scenarios

| Scenario | Example |
|----------|---------|
| News Collection | Automatically gather industry news and generate a summary every morning |
| Inbox Cleanup | Periodically check your inbox, categorize emails, and summarize important ones |
| Data Reports | Generate a weekly business data analysis report |
| Content Monitoring | Regularly check specific websites for changes and send notifications |
| Work Reminders | Generate to-do lists or meeting notes on a schedule |

Scheduled tasks are powered by Cron expressions, supporting minute, hourly, daily, weekly, and monthly intervals. When a task fires, it automatically starts a Cowork session. Results can be viewed on the desktop or pushed to your phone via IM.

## IM Integration — Mobile Remote Control

LobsterAI can bridge the Agent to multiple IM platforms. Send a message from your phone via IM to remotely trigger the desktop Agent — command your personal assistant anytime, anywhere.

| Platform | Protocol | Description |
|----------|----------|-------------|
| WeChat | OpenClaw gateway | WeChat account integration, supports DMs and group chats |
| WeCom | OpenClaw gateway | WeCom app bot, supports DMs and group chats |
| DingTalk | OpenClaw gateway | Enterprise bot, supports multiple instances |
| Feishu | OpenClaw gateway | Feishu/Lark app bot, supports multiple instances |
| QQ | OpenClaw gateway | QQ bot (official Bot API), supports multiple instances |
| Telegram | OpenClaw gateway | Bot API, supports webhook and polling |
| Discord | OpenClaw gateway | Discord bot, supports servers and DMs |
| NetEase IM | node-nim V2 SDK | [NetEase IM P2P messaging](https://doc.yunxin.163.com/messaging2/getting-started) |
| NetEase Bee | node-nim V2 SDK | [NetEase Bee personal digital assistant](https://wp.m.163.com/163/html/bee/lobsterai_guide/index.html) |
| NetEase POPO | OpenClaw gateway | NetEase POPO enterprise IM, supports WebSocket and Webhook |

Configure the corresponding platform Token/Secret in the Settings panel to enable. Once set up, you can send instructions directly to the Agent from your phone IM (e.g., "analyze this dataset", "make a weekly summary PPT"), and the Agent will execute on the desktop and return results.

## Persistent Memory

LobsterAI's memory system is built on OpenClaw and persists information as files in the working directory, so the Agent remembers your preferences and context across sessions.

### Memory File Structure

| File | Purpose |
|------|---------|
| `MEMORY.md` | Durable facts, preferences, and decisions — loaded automatically at session start |
| `memory/YYYY-MM-DD.md` | Daily notes — preserves recent context |
| `USER.md` | User profile (name, occupation, habits, long-term info) |
| `SOUL.md` | Agent personality and behavioral principles |

### How Memories Are Written

- **Explicit instructions** — Say "remember that…" or "from now on reply in English," and the Agent calls the `write` tool to save to `MEMORY.md` before acknowledging — no silent "mental notes"
- **Agent-initiated** — The Agent can proactively write important findings, configurations, or environment notes to memory files during task execution, without explicit prompting
- **GUI management** — Add, edit, or delete entries in `MEMORY.md` directly from the Settings panel; keyword search is supported

### How It Works

At the start of every session, OpenClaw reads `SOUL.md`, `USER.md`, today's and yesterday's `memory/YYYY-MM-DD.md`, and `MEMORY.md` in sequence, injecting them as context. This lets the Agent pick up where it left off without you needing to re-explain preferences.

Memory writes go through file tools — there is no background extraction or inference. Content is fully under user or Agent control.

## Data Storage

All data is stored in a local SQLite database (`lobsterai.sqlite` in the user data directory).

<details>
<summary>Database tables</summary>

| Table | Purpose |
|-------|---------|
| `kv` | App configuration key-value pairs |
| `cowork_config` | Cowork settings (working directory, system prompt, execution mode) |
| `cowork_sessions` | Session metadata |
| `cowork_messages` | Message history |
| `user_memories` | User memory entries |
| `user_memory_sources` | Memory source tracking |
| `agents` | Custom Agent configurations |
| `mcp_servers` | MCP server configurations |
| `im_config` | IM gateway config (tokens/secrets per platform) |
| `im_session_mappings` | Mapping between IM conversations and Cowork sessions |
| `scheduled_task_meta` | Scheduled task metadata (origin and binding info) |

</details>

## Security Model

LobsterAI enforces security at multiple layers:

- **Process Isolation** — Context isolation enabled, node integration disabled
- **Permission Gating** — Tool invocations require explicit user approval
- **Workspace Boundaries** — File operations restricted to the designated working directory
- **IPC Validation** — All cross-process calls are type-checked

## Tech Stack

<details>
<summary>Full tech stack</summary>

| Layer | Technology |
|-------|-----------|
| Framework | Electron 40 |
| Frontend | React 18 + TypeScript |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 |
| State | Redux Toolkit |
| AI Engine | OpenClaw (primary) |
| Storage | better-sqlite3 |
| Markdown | react-markdown + remark-gfm + rehype-katex |
| Diagrams | Mermaid |
| Security | DOMPurify |
| IM | @larksuiteoapi/node-sdk · nim-web-sdk-ng · @wecom/wecom-aibot-sdk · OpenClaw gateway (DingTalk / Telegram / Discord / QQ etc.) |

</details>

## Configuration

### App Configuration

App-level config is stored in the SQLite `kv` table, editable through the Settings panel.

### Cowork Configuration

Cowork session config includes:

- **Working Directory** — Root directory for Agent operations
- **System Prompt** — Customize Agent behavior

### Internationalization

Currently English and Chinese are supported. Switch languages in the Settings panel.

## OpenClaw Version Management

<details>
<summary>Version pinning, how it works, updating & env vars</summary>

LobsterAI pins its OpenClaw dependency to a specific release version, declared in `package.json`:

```json
{
  "openclaw": {
    "version": "v2026.4.14",
    "repo": "https://github.com/openclaw/openclaw.git"
  }
}
```

### How It Works

| Step | What happens | When |
|------|-------------|------|
| **Version ensure** | Clones or checks out the pinned tag in `../openclaw` | Before every runtime build |
| **Build cache check** | Compares pinned version with `runtime-build-info.json` | Before every runtime build |
| **Full build** | `pnpm install` → `build` → `ui:build` → pack to asar | Only when version changed |

### Updating OpenClaw Version

1. Change `openclaw.version` in `package.json` to the desired release tag
2. Run `npm run electron:dev:openclaw` or `npm run dist:win` — the new version is fetched and built automatically
3. Commit the `package.json` change

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCLAW_SRC` | Path to OpenClaw source directory | `../openclaw` |
| `OPENCLAW_FORCE_BUILD` | Set to `1` to force rebuild even if version matches | — |
| `OPENCLAW_SKIP_ENSURE` | Set to `1` to skip automatic version checkout | — |
| `LOBSTERAI_SQLITE_BACKUP_ALWAYS_ON_STARTUP` | Set to `1` or `true` to force an automatic backup on every app startup for QA/testing | — |

</details>

## Development Guidelines

- TypeScript strict mode, functional components + Hooks
- 2-space indentation, single quotes, semicolons
- Components: `PascalCase`; functions/variables: `camelCase`; Redux slices: `*Slice.ts`
- Tailwind CSS preferred; avoid custom CSS
- Commit messages follow `type: short imperative summary` (e.g., `feat: add artifact toolbar`)

## Testing

<details>
<summary>Running tests & writing test files</summary>

Unit tests use [Vitest](https://vitest.dev/) and are co-located with the source files they cover.

```bash
# run all tests
npm test

# run tests for a specific module (Vitest filename filter)
npm test -- logger
npm test -- cowork
```

New test files go next to the source file they test, using the `.test.ts` extension:

```
src/main/
├── foo.ts
└── foo.test.ts
```

Example (`src/main/logger.test.ts`):

```ts
import { test, expect } from 'vitest';

test('log file pattern matches daily name', () => {
  expect(/^main-\d{4}-\d{2}-\d{2}\.log$/.test('main-2026-03-20.log')).toBe(true);
});
```

Avoid importing Electron-only APIs (e.g. `electron-log`) in tests — inline any logic that depends on them instead.

</details>



## Community

Join our WeChat group to get help, share feedback, and stay up to date:

<p align="center">
  <img src="https://shared.ydstatic.com/market/souti/fihserChatWeb/online/2.0.4/dist/assets/wechat_group-B34qRm1G.png" alt="WeChat Community QR Code" width="200">
</p>

## Contributing

1. Fork this repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'feat: add something'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

Please include in your PR description: a summary of changes, linked issue (if any), screenshots for UI changes, and notes on any Electron-specific behavior changes.

## License

[MIT License](LICENSE)


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=netease-youdao/LobsterAI&type=date&legend=top-left)](https://www.star-history.com/#netease-youdao/LobsterAI&type=date&legend=top-left)

---

Built and maintained by [NetEase Youdao](https://www.youdao.com/).
