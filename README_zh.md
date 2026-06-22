# LobsterAI — 全场景办公助手 Agent

<p align="center">
  <img src="public/logo.png" alt="LobsterAI" width="120">
</p>

<p align="center">
  <strong>7×24 小时帮你干活的全场景办公助手 Agent，由网易有道出品</strong>
</p>

<p align="center">
  <em>国内大厂首个开源桌面级 Agent，获 OpenClaw 创始人公开称赞。</em>
</p>

<p align="center">
  <a href="https://github.com/netease-youdao/LobsterAI/stargazers"><img src="https://img.shields.io/github/stars/netease-youdao/LobsterAI?style=for-the-badge&logo=github&color=FFD43B" alt="GitHub stars"></a>
  <a href="https://github.com/netease-youdao/LobsterAI/releases"><img src="https://img.shields.io/github/v/release/netease-youdao/LobsterAI?style=for-the-badge&color=brightgreen" alt="最新版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <br>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-brightgreen?style=for-the-badge" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
</p>

<p align="center">
  <a href="https://github.com/netease-youdao/LobsterAI/releases"><strong>⬇️ 下载客户端</strong></a>
  &nbsp;·&nbsp;
  <a href="#微信社群"><strong>💬 微信社群</strong></a>
  &nbsp;·&nbsp;
  <a href="https://www.star-history.com/#netease-youdao/LobsterAI&type=date"><strong>⭐ Star 趋势</strong></a>
  &nbsp;·&nbsp;
  <a href="README.md">English</a> · 中文
</p>

---

**LobsterAI** 是由[网易有道](https://www.youdao.com/)出品的全场景办公助手 Agent —— 国内大厂首个开源桌面级 Agent。它 7×24 小时待命，真正帮你把活干完：数据分析、制作 PPT、生成视频、撰写文档、网络调研、收发邮件、定时任务，以及更多。

与只能聊天的助手不同，LobsterAI 是**桌面级** Agent。借助 **Cowork 模式**，它能直接连接你的文件、终端、浏览器与本地项目，在真实工作环境中执行工具、运行命令 —— 每一次敏感操作都需经你批准。你可以创建专用 Agent（股票研究、内容创作、备课出卷……），用专家套件、技能与 MCP 服务持续扩展能力，还能通过微信、企业微信、钉钉、飞书、QQ、Telegram、Discord 等 IM 在手机上随时指挥电脑干活。

## 为什么选择 LobsterAI

- **🔓 代码开源，安全可信** — 代码 100% 开源，能力透明可查，权限、数据与执行链路全程可审计
- **🖥️ 桌面级 Agent** — 可连接文件、终端、浏览器与本地项目，直接进入真实工作环境，而非沙箱里的对话框
- **🧩 OpenClaw 生态扩展** — 基于开源 OpenClaw Agent 框架，技能、工具、MCP 服务与模型持续接入
- **📱 手机远程指挥电脑干活** — 通过微信、企微、钉钉、飞书、QQ、Telegram、Discord 等 IM，7×24 小时远程指挥 LobsterAI
- **🔒 数据本地，操作可控** — 会话、配置与记忆都留在本机，每次工具调用都有门控记录

## 能力总览

- **全场景办公** — 数据分析、PPT 制作、视频生成、文档撰写、Web 搜索、邮件收发，覆盖日常办公全流程
- **自定义 Agent** — 创建专用 Agent（如股票助手、内容创作、备课出卷专家），各自拥有身份设定、技能与 IM 渠道
- **专家套件与技能** — 28 个内置技能，外加可安装的专家套件；可用 `skill-creator` 自建技能并热加载
- **MCP 支持** — 通过 Model Context Protocol 服务接入外部工具与数据源
- **定时任务** — 对话式或 GUI 创建周期任务 —— 每日新闻、邮箱整理、定期报告等
- **持久记忆** — 以文件形式跨会话记住你的偏好与上下文，越用越懂你
- **本地优先** — 任务可在本地直接运行
- **跨平台** — macOS（Intel + Apple Silicon）、Windows 桌面端，配合 IM 实现移动端覆盖
- **Windows 内置 Python 运行时** — Windows 安装包内置开箱即用的 Python 解释器；技能依赖可按需安装

## 实战场景

| 场景 | 示例指令 |
|------|---------|
| **从 0 到 1 开发一套系统** | 「我开了家小店，每天还用 Excel 记进货和销售，太乱了。帮我做一套进销存管理系统：能录入进货、登记销售、自动算库存和利润，本地直接打开就能用。」 |
| **改本地文件、处理数据、生成网页** | 「基于 `产品增长数据.xlsx` 里的数据，帮我做一个可视化页面。」 |
| **每日定时整理科技新闻** | 「每天早上 9 点把前一天的 AI 科技新闻发给我，重点关注 OpenAI、Anthropic、Google 和国内公司。」 |
| **深度调研 + PPT 生成** | 「深度调研全球 Agent 产品市场格局，并把当前文件夹里的 `流量报告.pdf` 做成汇报 PPT。」 |
| **浏览器自动化** | 「每天打开广告后台，看消耗、转化率、线索成本是否异常，异常就总结原因。」 |
| **简历筛选与文档初审** | 「把这个文件夹里的 50 份简历整理成筛选表，对照岗位 JD 标出不符合硬性要求的，再挑出最匹配的 10 人。」 |
| **持续成长，越用越懂你** | 「以后帮我写文档都要逻辑清晰、言简意赅。」 —— 写入长期记忆 |

## 工作原理

<p align="center">
  <img src="docs/res/architecture_v2_zh.png" alt="Architecture" width="500">
</p>

## 快速开始

### 环境要求

- **Node.js** >= 24 < 25
- **npm**

### 1. 克隆与安装

```bash
git clone https://github.com/netease-youdao/LobsterAI.git
cd LobsterAI
npm install
```

### 2. 启动应用

> [!IMPORTANT]
> Cowork 模式依赖 **OpenClaw** Agent 引擎。**首次启动必须先构建 OpenClaw runtime**，否则 Cowork 会话无法启动。首次启动请使用 `electron:dev:openclaw` 命令。

```bash
# 首次运行：先构建 OpenClaw runtime，再启动应用。
# 首次会自动克隆并构建 OpenClaw，可能需要几分钟。
npm run electron:dev:openclaw
```

runtime 构建完成后，日常开发可使用更快的命令 —— 它复用已构建的 runtime，跳过 OpenClaw 构建步骤：

```bash
npm run electron:dev
```

Vite 开发服务器默认运行在 `http://localhost:5175`。应用默认连接 LobsterAI 的**正式（生产）服务**，无需额外配置即可登录使用。

#### OpenClaw 构建选项

所依赖的 OpenClaw 版本在 `package.json` 的 `openclaw.version` 字段声明，源码默认克隆/管理在 `../openclaw`（相对于本仓库）。

```bash
# 指定 OpenClaw 源码路径
OPENCLAW_SRC=/path/to/openclaw npm run electron:dev:openclaw

# 强制重新构建（即使锁定版本未变）
OPENCLAW_FORCE_BUILD=1 npm run electron:dev:openclaw

# 跳过自动版本切换（如需本地开发 OpenClaw 时）
OPENCLAW_SKIP_ENSURE=1 npm run electron:dev:openclaw
```

### 生产构建

```bash
# 编译 TypeScript + Vite 打包
npm run build

# ESLint 代码检查
npm run lint
```

## 打包分发

<details>
<summary>构建命令、渠道包、手动构建 runtime 与 Windows Python 内置</summary>

使用 [electron-builder](https://www.electron.build/) 生成各平台安装包，输出到 `release/` 目录。

```bash
# macOS (.dmg)
npm run dist:mac

# macOS - 仅 Intel
npm run dist:mac:x64

# macOS - 仅 Apple Silicon
npm run dist:mac:arm64

# macOS - Universal (双架构)
npm run dist:mac:universal

# Windows (.exe NSIS 安装包)
npm run dist:win

# Linux (.AppImage)
npm run dist:linux

```

按照 keyfrom 打不同渠道的专属包
```
# macOS - 仅 Intel
KEYFROM=xxx npm run dist:mac:x64

# macOS - 仅 Apple Silicon
KEYFROM=xxx npm run dist:mac:arm64

# Windows (.exe NSIS 安装包)
npx cross-env KEYFROM=xxx npm run dist:win
```

桌面端打包（macOS / Windows / Linux）都会把预构建的 OpenClaw runtime 内置到 `Resources/cfmind`。
锁定的 OpenClaw 版本（`package.json` → `openclaw.version`）在打包时会自动拉取并构建，无需手动操作。
构建结果带缓存：如果本地已存在对应版本的 runtime，构建步骤会自动跳过。

也可以手动构建 OpenClaw runtime：

```bash
# 按当前主机平台自动选择 target（mac/win/linux + 架构）
npm run openclaw:runtime:host

# 显式指定目标平台
npm run openclaw:runtime:mac-arm64
npm run openclaw:runtime:mac-x64
npm run openclaw:runtime:win-x64
npm run openclaw:runtime:linux-x64
```

如需覆盖 OpenClaw 源码路径：

```bash
OPENCLAW_SRC=/path/to/openclaw npm run dist:win
```

Windows 打包会内置便携 Python 运行时到 `resources/python-win`（安装包资源目录为 `python-win`），终端用户无需手动安装 Python。
该运行时以解释器为主，不预装 LobsterAI 技能所需的 Python 三方包；相关依赖可在运行时按需安装。
默认情况下，如果未提供预构建压缩包，打包脚本会直接从 python.org 下载官方 embeddable Python 运行时。
离线或无法联网的构建场景，请显式提供预构建运行时压缩包。

企业离线/私有源打包可通过以下环境变量配置：
- `LOBSTERAI_PORTABLE_PYTHON_ARCHIVE`：本地预构建运行时压缩包路径（离线 CI/CD 推荐）
- `LOBSTERAI_PORTABLE_PYTHON_URL`：预构建运行时压缩包下载地址
- `LOBSTERAI_WINDOWS_EMBED_PYTHON_VERSION` / `LOBSTERAI_WINDOWS_EMBED_PYTHON_URL` / `LOBSTERAI_WINDOWS_GET_PIP_URL`：Windows 主机构建时自动拉取源的可选覆盖项

</details>

## 架构概览

LobsterAI 采用 Electron 严格进程隔离架构，所有跨进程通信通过 IPC 完成。

### 进程模型

**Main Process**（`src/main/main.ts`）：
- 窗口生命周期管理
- SQLite 数据持久化
- OpenClaw Agent 引擎（主引擎）+ CoworkEngineRouter 调度层
- IM 网关 — 微信、企业微信、钉钉、飞书、QQ、Telegram、Discord、POPO 远程接入
- 40+ IPC 通道处理
- 安全：context isolation 启用，node integration 禁用，sandbox 启用

**Preload Script**（`src/main/preload.ts`）：
- 通过 `contextBridge` 暴露 `window.electron` API
- 包含 `cowork` 命名空间用于会话管理和流式事件

**Renderer Process**（`src/renderer/`）：
- React 18 + Redux Toolkit + Tailwind CSS
- 所有 UI 和业务逻辑
- 仅通过 IPC 与主进程通信

### 目录结构

<details>
<summary>查看完整源码目录</summary>

```
src/
├── main/                           # Electron 主进程
│   ├── main.ts                     # 入口，IPC 处理
│   ├── preload.ts                  # 安全桥接
│   ├── sqliteStore.ts              # SQLite 存储
│   ├── coworkStore.ts              # 会话/消息 CRUD
│   ├── skillManager.ts             # 技能管理
│   ├── im/                         # IM 网关（钉钉/飞书/Telegram/Discord）
│   └── libs/
│       ├── agentEngine/
│       │   ├── coworkEngineRouter.ts    # 调度层（将会话路由到当前激活的引擎）
│       │   ├── openclawRuntimeAdapter.ts # 主引擎 OpenClaw 网关适配器
│       │   └── claudeRuntimeAdapter.ts  # 旧内置适配器（已废弃）
│       ├── coworkRunner.ts          # 旧内置执行器（已废弃）
│       ├── openclawEngineManager.ts # OpenClaw 运行时生命周期管理
│       ├── openclawConfigSync.ts    # 同步 cowork 配置到 OpenClaw 配置文件
│       └── coworkMemoryExtractor.ts # 记忆提取
│
├── renderer/                        # React 前端
│   ├── App.tsx                     # 根组件
│   ├── types/                      # TypeScript 类型定义
│   ├── store/slices/               # Redux 状态切片
│   ├── services/                   # 业务逻辑层（API/IPC/i18n）
│   └── components/
│       ├── cowork/                 # Cowork UI 组件
│       ├── artifacts/              # Artifact 渲染器
│       ├── skills/                 # 技能管理 UI
│       ├── im/                     # IM 集成 UI
│       └── Settings.tsx            # 设置面板
│
SKILLs/                              # 技能定义目录
├── skills.config.json              # 技能启停与排序配置
├── web-search/                     # Web 搜索
├── docx/                           # Word 文档生成
├── xlsx/                           # Excel 表格
├── pptx/                           # PowerPoint 演示
├── pdf/                            # PDF 处理
├── remotion/                       # 视频生成
├── playwright/                     # Web 自动化
└── ...                             # 更多技能
```

</details>

## Cowork 系统

Cowork 是 LobsterAI 的核心功能 —— 以 OpenClaw 为主引擎的 AI 工作会话系统。它面向办公场景设计，能够自主完成数据分析、文档生成、信息检索等复杂任务。

<details>
<summary>执行模式、流式事件与权限控制</summary>

### 执行模式

| 模式 | 说明 |
|------|------|
| `auto` | 自动根据上下文选择执行方式 |
| `local` | 本地直接执行，全速运行 |

### 流式事件

Cowork 通过 IPC 事件实现实时双向通信：

- `message` — 新消息加入会话
- `messageUpdate` — 流式内容增量更新
- `permissionRequest` — 工具执行需要用户审批
- `complete` — 会话执行完毕
- `error` — 执行出错

### 权限控制

所有涉及文件系统、终端命令、网络请求的工具调用都需要用户在 `CoworkPermissionModal` 中明确批准。支持单次批准和会话级批准。

</details>


## 技能系统

LobsterAI 内置很多 skill，覆盖办公、创作、投研、自动化等多种场景，通过 `SKILLs/skills.config.json` 配置启停和排序，以下是一些典型的 skill 案例：

<details>
<summary>查看完整技能列表</summary>

| 技能 | 功能 | 典型场景 |
|------|------|---------|
| web-search | Web 搜索 | 信息检索、资料收集 |
| docx | Word 文档生成 | 报告撰写、方案输出 |
| xlsx | Excel 表格生成 | 数据分析、报表制作 |
| pptx | PowerPoint 制作 | 演示文稿、汇报材料 |
| pdf | PDF 处理 | 文档解析、格式转换 |
| remotion | 视频生成（Remotion） | 宣传视频、数据可视化动画 |
| seedance | AI 视频生成（Seedance） | 文生视频、图生视频 |
| seedream | AI 图片生成（Seedream） | 文生图、图片编辑与融合 |
| playwright | Web 自动化 | 网页操作、自动化测试 |
| canvas-design | Canvas 绘图设计 | 海报、图表设计 |
| frontend-design | 前端 UI 设计 | 原型制作、页面设计 |
| develop-web-game | Web 游戏开发 | 小游戏快速原型 |
| stock-analyzer | 股票深度分析 | A 股深度研究、估值与财报分析 |
| stock-announcements | 股票公告获取 | 上市公司公告检索、信息披露查阅 |
| stock-explorer | 股票信息探索 | 股票基本信息查询、行情概览 |
| content-planner | 内容规划 | 选题策划、内容日历制作 |
| article-writer | 文章撰写 | 多风格长文创作、自媒体内容生成 |
| daily-trending | 每日热榜 | 热点资讯聚合、趋势追踪 |
| films-search | 影视资源搜索 | 电影/剧集网盘资源检索下载 |
| music-search | 音乐资源搜索 | 歌曲/专辑网盘资源检索下载 |
| technology-news-search | 科技资讯搜索 | 编程、AI、IT 行业动态（默认禁用） |
| weather | 天气查询 | 天气信息获取 |
| local-tools | 本地系统工具 | 文件管理、系统操作 |
| imap-smtp-email | 邮件收发 | 邮件处理、自动回复 |
| create-plan | 计划编排 | 项目规划、任务分解 |
| youdaonote | 有道云笔记 | 笔记管理、待办管理、网页剪藏 |
| skill-vetter | 技能安全审查 | 安装第三方技能前的安全检验 |
| skill-creator | 自定义技能创建 | 扩展新能力 |

</details>

支持通过 `skill-creator` 创建自定义技能并热加载。

## 定时任务

LobsterAI 支持创建定时任务，让 Agent 按计划自动执行重复性工作。

### 创建方式

- **对话式创建** — 直接用自然语言告诉 Agent（如「每天早上 9 点帮我收集科技新闻」），Agent 会自动创建对应的定时任务
- **GUI 界面创建** — 在定时任务管理面板中手动添加，可视化配置执行时间和任务内容

### 典型场景

| 场景 | 示例 |
|------|------|
| 新闻收集 | 每天早上自动收集行业资讯并生成摘要 |
| 邮箱整理 | 定时检查收件箱，分类整理并汇总重要邮件 |
| 数据报告 | 每周自动生成业务数据分析报告 |
| 信息监控 | 定期检查指定网站内容变化并通知 |
| 工作提醒 | 按计划生成待办事项清单或会议纪要 |

定时任务基于 Cron 表达式调度，支持分钟、小时、日、周、月等多种周期粒度。任务执行时会自动启动 Cowork 会话，结果可通过桌面端查看或经 IM 推送到手机。

## IM 集成 — 手机端远程操控

LobsterAI 支持将 Agent 桥接到多种 IM 平台。在手机上通过 IM 发送消息即可远程触发桌面端的 Agent 执行任务，随时随地指挥你的个人助理。

| 平台 | 协议 | 说明 |
|------|------|------|
| 微信 | OpenClaw 网关 | 微信账号接入，支持私聊与群聊 |
| 企业微信 | OpenClaw 网关 | 企业微信应用机器人，支持私聊与群聊 |
| 钉钉 | DingTalk Stream | 企业机器人双向通信，支持多实例 |
| 飞书 | Lark SDK | 飞书/Lark 应用机器人，支持多实例 |
| QQ | OpenClaw 网关 | QQ 机器人接入（官方 Bot API），支持多实例 |
| Telegram | grammY | Bot API 接入，支持 Webhook 与轮询 |
| Discord | discord.js | Discord Bot 接入，支持服务器与私聊 |
| 云信 IM | node-nim V2 SDK | [网易云信 IM P2P 私聊](https://doc.yunxin.163.com/messaging2/getting-started) |
| 网易小蜜蜂 | node-nim V2 SDK | [网易小蜜蜂个人数字助理](https://wp.m.163.com/163/html/bee/lobsterai_guide/index.html) |
| 网易 POPO | OpenClaw 网关 | 网易 POPO 企业 IM，支持 WebSocket 与 Webhook 两种接入方式 |

在设置面板中配置对应平台的 Token/密钥即可启用。配置完成后，你可以在手机 IM 中直接对 Agent 下达指令（如「帮我分析这份数据」「做一份本周工作汇报 PPT」），Agent 会在桌面端自动执行并返回结果。

## 持久记忆

LobsterAI 的记忆系统基于 OpenClaw，以文件形式持久化存储在工作目录中，让 Agent 跨会话记住你的信息和偏好。

### 记忆文件结构

| 文件 | 用途 |
|------|------|
| `MEMORY.md` | 持久化事实、偏好与决策，每次会话启动时自动加载 |
| `memory/YYYY-MM-DD.md` | 每日临时笔记，保留近期上下文 |
| `USER.md` | 用户档案（姓名、职业、习惯等长期信息） |
| `SOUL.md` | Agent 个性与行为准则 |

### 记忆的写入方式

- **显式指令** — 对话中说「记住 xxx」「以后回复用英文」等，Agent 会在回复前先调用 `write` 工具将信息写入 `MEMORY.md`，确认写入成功后再回复「记住了」
- **Agent 自动记录** — Agent 在执行任务过程中可主动将重要发现、配置、环境信息等写入记忆文件，无需用户显式要求
- **GUI 手动管理** — 在设置面板的记忆管理界面中直接添加、编辑、删除 `MEMORY.md` 中的条目；支持关键词搜索

### 工作机制

每次会话启动时，OpenClaw 会按顺序读取 `SOUL.md`、`USER.md`、今日及昨日的 `memory/YYYY-MM-DD.md`，以及 `MEMORY.md`，将这些内容作为上下文注入，使 Agent 无需用户重复说明就能延续上次的偏好和认知。

记忆写入通过文件工具完成，不依赖任何后台提取或推断，内容完全由用户或 Agent 明确控制。

## 数据存储

所有数据存储在本地 SQLite 数据库（`lobsterai.sqlite`，位于用户数据目录）。

<details>
<summary>数据库表</summary>

| 表 | 用途 |
|----|------|
| `kv` | 应用配置键值对 |
| `cowork_config` | Cowork 设置（工作目录、系统提示词、执行模式） |
| `cowork_sessions` | 会话元数据 |
| `cowork_messages` | 消息历史 |
| `user_memories` | 用户记忆条目 |
| `user_memory_sources` | 记忆来源追踪 |
| `agents` | 自定义 Agent 配置 |
| `mcp_servers` | MCP 服务器配置 |
| `im_config` | IM 网关配置（各平台 Token/密钥） |
| `im_session_mappings` | IM 会话与 Cowork 会话的映射关系 |
| `scheduled_task_meta` | 定时任务元数据（来源与绑定信息） |

</details>

## 安全模型

LobsterAI 在多个层面实施安全控制：

- **进程隔离** — context isolation 启用，node integration 禁用
- **权限门控** — 敏感工具调用需用户明确审批
- **工作区边界** — 文件操作限制在指定工作目录内
- **IPC 验证** — 所有跨进程调用经过类型检查

## 技术栈

<details>
<summary>完整技术栈</summary>

| 层 | 技术 |
|----|------|
| 框架 | Electron 40 |
| 前端 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| 状态 | Redux Toolkit |
| AI 引擎 | OpenClaw（主引擎） |
| 存储 | better-sqlite3 |
| Markdown | react-markdown + remark-gfm + rehype-katex |
| 图表 | Mermaid |
| 安全 | DOMPurify |
| IM | @larksuiteoapi/node-sdk · nim-web-sdk-ng · @wecom/wecom-aibot-sdk · OpenClaw 网关（钉钉 / Telegram / Discord / QQ 等） |

</details>

## 配置

### 应用配置

应用级配置存储在 SQLite `kv` 表中，通过设置面板修改。

### Cowork 配置

Cowork 会话配置包含：

- **工作目录** — Agent 操作的根目录
- **系统提示词** — 自定义 Agent 行为

### 国际化

支持中文（默认）和英文两种语言，通过设置面板切换。

## OpenClaw 版本管理

<details>
<summary>版本锁定、工作原理、更新方式与环境变量</summary>

LobsterAI 将 OpenClaw 依赖锁定到指定的 release 版本，在 `package.json` 中声明：

```json
{
  "openclaw": {
    "version": "v2026.4.14",
    "repo": "https://github.com/openclaw/openclaw.git"
  }
}
```

### 工作原理

| 步骤 | 行为 | 时机 |
|------|------|------|
| **版本确认** | 克隆或切换 `../openclaw` 到锁定的 tag | 每次 runtime 构建前 |
| **构建缓存检查** | 比对锁定版本与 `runtime-build-info.json` | 每次 runtime 构建前 |
| **完整构建** | `pnpm install` → `build` → `ui:build` → 打包为 asar | 仅版本变更时 |

### 更新 OpenClaw 版本

1. 修改 `package.json` 中 `openclaw.version` 为目标 release tag
2. 执行 `npm run electron:dev:openclaw` 或 `npm run dist:win` — 新版本会自动拉取并构建
3. 提交 `package.json` 的变更

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENCLAW_SRC` | OpenClaw 源码目录路径 | `../openclaw` |
| `OPENCLAW_FORCE_BUILD` | 设为 `1` 强制重新构建（即使版本匹配） | — |
| `OPENCLAW_SKIP_ENSURE` | 设为 `1` 跳过自动版本切换 | — |

</details>

## 测试

<details>
<summary>运行测试与编写测试文件</summary>

单元测试使用 [Vitest](https://vitest.dev/)，测试文件与被测源文件**同目录存放**。

```bash
# 运行全部测试
npm test

# 只运行指定模块的测试（按文件名过滤）
npm test -- logger
npm test -- cowork
```

新增测试文件放在对应源文件旁边，使用 `.test.ts` 扩展名：

```
src/main/
├── foo.ts
└── foo.test.ts
```

示例（`src/main/logger.test.ts`）：

```ts
import { test, expect } from 'vitest';

test('log file pattern matches daily name', () => {
  expect(/^main-\d{4}-\d{2}-\d{2}\.log$/.test('main-2026-03-20.log')).toBe(true);
});
```

避免在测试中引入 Electron 专属 API（如 `electron-log`），改为将相关逻辑内联到测试文件中。

</details>

## 开发规范

- TypeScript 严格模式，函数式组件 + Hooks
- 2 空格缩进，单引号，分号
- 组件 `PascalCase`，函数/变量 `camelCase`，Redux 切片 `*Slice.ts`
- Tailwind CSS 优先，避免自定义 CSS
- 提交信息遵循 `type: short imperative summary` 格式（如 `feat: add artifact toolbar`）

## 微信社群

扫码加入微信交流群，获取帮助、反馈问题、了解最新动态：

<p align="center">
  <img src="https://shared.ydstatic.com/market/souti/fihserChatWeb/online/2.0.4/dist/assets/wechat_group-B34qRm1G.png" alt="微信社群二维码" width="200">
</p>

## 贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/your-feature`)
3. 提交改动 (`git commit -m 'feat: add something'`)
4. 推送到远程 (`git push origin feature/your-feature`)
5. 发起 Pull Request

PR 描述中请包含：变更说明、关联 issue、UI 变更附截图，以及涉及 Electron 特定行为的说明。

## 许可证

[MIT License](LICENSE)


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=netease-youdao/LobsterAI&type=date&legend=top-left)](https://www.star-history.com/#netease-youdao/LobsterAI&type=date&legend=top-left)


---

由[网易有道](https://www.youdao.com/)开发维护。
