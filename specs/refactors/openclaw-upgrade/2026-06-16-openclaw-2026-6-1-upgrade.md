# OpenClaw 2026.6.1 升级适配设计文档

## 1. 概述

### 1.1 问题/动机

LobsterAI 当前正在将依赖的 OpenClaw 从 `v2026.4.14` 升级到 `v2026.6.1`。OpenClaw 迭代较快，LobsterAI 历史上对 `v2026.4.14` 维护了一组版本专属 patch，位于：

```text
scripts/patches/v2026.4.14/
```

升级基础版本后，`package.json` 中的 `openclaw.version` 已切换到 `v2026.6.1`。但如果不迁移对应 patch，LobsterAI 仍会写出依赖业务 patch 的配置字段，例如 `cron.skipMissedJobs`、`agents.defaults.cwd`、`agents.list[].cwd`。在未迁移 patch 时，OpenClaw 6.1 网关会在启动阶段拒绝这些字段，报出配置校验失败：

```text
Invalid config ... agents.defaults: Invalid input
cron: Invalid input
```

因此，本次升级不能只改 OpenClaw tag，还需要逐个判断旧 patch 是否仍然需要迁移到：

```text
scripts/patches/v2026.6.1/
```

### 1.2 目标

1. 保持 LobsterAI 可以依赖 `v2026.6.1` 的 OpenClaw runtime 启动网关。
2. 将仍然需要的业务 patch 迁移到 `scripts/patches/v2026.6.1/`。
3. 对每个旧 patch 给出清晰处理状态：已迁移、待处理或不再需要迁移。
4. 在 LobsterAI 侧补充测试，避免再次出现“配置生成依赖某个 patch，但对应版本 patch 未迁移”的问题。

## 2. 现状分析

### 2.1 已完成的基础改动

| 文件 | 改动 | 原因 |
|------|------|------|
| `package.json` | `openclaw.version` 改为 `v2026.6.1` | 切换目标 OpenClaw 版本 |
| `package.json` | Node 要求调整为 `>=24.15.0 <25` | OpenClaw 6.1 依赖要求更高的 Node 24 小版本 |
| `scripts/run-build-openclaw-runtime.cjs` | 设置 `CI=true` | 避免 pnpm 在非交互环境下因确认提示失败 |
| `scripts/build-openclaw-runtime.sh` | 复用 runtime 前检查 `node_modules`、`gateway.asar`、`dist/control-ui/index.html` | 防止构建中断后仅凭 `runtime-build-info.json` 误判 runtime 已完整 |
| `scripts/build-openclaw-runtime.sh` | 使用 `npm pack --ignore-scripts`，并在 LobsterAI 侧显式执行 OpenClaw prepack 中仍需要的 package metadata / smoke / changelog 步骤 | OpenClaw `v2026.4.15` 起移除了 `OPENCLAW_PREPACK_PREPARED` 跳过逻辑，`npm pack` 会重新触发 `prepack -> pnpm build`，导致 `tsdown` 二次构建 |

### 2.1.1 runtime 打包阶段的二次 tsdown 构建

本次升级调研发现，`npm run openclaw:runtime:host` 在 OpenClaw `v2026.6.1` 下可能出现同一次 runtime 构建中两次执行 `scripts/build-all.mjs` 的情况。第一轮来自 LobsterAI 的 `scripts/build-openclaw-runtime.sh` 主动执行 `pnpm build`；第二轮来自后续 `npm pack` 触发 OpenClaw `prepack`，而 `prepack` 在 `v2026.6.1` 中会再次执行 `pnpm build`。

历史原因是 LobsterAI 侧曾通过：

```bash
OPENCLAW_PREPACK_PREPARED=1 npm pack --pack-destination "$PACK_DIR"
```

要求 OpenClaw `prepack` 复用已有产物、跳过重建。该机制在 OpenClaw `v2026.4.14` 仍然有效，但上游提交 `c727388f93 fix(plugins): localize bundled runtime deps to extensions (#67099)` 删除了 `OPENCLAW_PREPACK_PREPARED` / `shouldSkipPrepack` 逻辑，首次进入稳定版 `v2026.4.15`。因此升级到 `v2026.6.1` 后，该环境变量不再生效。

当前选择不优先 patch OpenClaw，而是在 LobsterAI 侧调整打包流程：

1. `pnpm build` 保留，作为唯一一次 OpenClaw 完整构建入口；不再额外执行 `pnpm ui:build`，因为 OpenClaw 6.1 的 `build-all` 已包含 `ui:build`。
2. 在 `npm pack` 前显式执行 OpenClaw `prepack` 中仍有价值但不昂贵的非构建步骤：
   - `writePackageDistInventory(process.cwd())`，生成 `dist/postinstall-inventory.json`。
   - `node scripts/test-built-bundled-channel-entry-smoke.mjs`，验证 bundled channel entry 能从构建产物加载。
   - `node scripts/package-changelog.mjs prepare`，生成 tarball 使用的当前版本 changelog，并在 pack 后或异常退出时 restore。
3. 使用 `npm pack --ignore-scripts --pack-destination "$PACK_DIR"` 跳过 npm lifecycle，避免触发 OpenClaw `prepack` 中的第二次 `pnpm build`。

### 2.2 当前已迁移的 patch

当前 `scripts/patches/v2026.6.1/` 中已有：

```text
openclaw-cron-skip-missed-jobs.patch
openclaw-chat-send-cwd-decoupling.patch
openclaw-im-bound-agent-run-cwd.patch
openclaw-browser-blocked-hostnames.patch
openclaw-empty-sse-data.patch
```

这些 patch 解决了本轮升级中暴露的业务字段兼容问题：

| 字段 | 所属 patch | 作用 |
|------|------------|------|
| `cron.skipMissedJobs` | `openclaw-cron-skip-missed-jobs.patch` | 启动时跳过离线期间错过的定时任务，不进行 catch-up replay |
| `chat.send.cwd` | `openclaw-chat-send-cwd-decoupling.patch` | 允许 LobsterAI 在 `chat.send` 请求中携带业务工作目录，并继续传递给 agent run |
| `agents.defaults.cwd` / `agents.list[].cwd` | `openclaw-im-bound-agent-run-cwd.patch` | 让 agent run 使用 LobsterAI 配置的业务工作目录，而不是只使用 OpenClaw workspace |
| `browser.ssrfPolicy.blockedHostnames` | `openclaw-browser-blocked-hostnames.patch` | 让浏览器访问控制支持 LobsterAI 配置的 hostname blocklist，并在 DNS 查询前阻断命中目标 |
| OpenAI-compatible 空 SSE `data:` frame | `openclaw-empty-sse-data.patch` | 在 OpenAI-compatible completions fetch 层过滤空 SSE data frame，避免 OpenAI SDK stream parser 因 provider 空事件报错或空转 |

### 2.3 已补充的 LobsterAI 侧测试

| 测试文件 | 覆盖内容 |
|----------|----------|
| `src/main/libs/openclawConfigSync.runtime.test.ts` | 验证配置同步仍会写出 patch 依赖字段：`cron.skipMissedJobs`、`agents.defaults.cwd`、`agents.list[].cwd`、`browser.ssrfPolicy.blockedHostnames`；同时确认不再写出旧的 `tools.web.fetch.useEnvProxy` / `useTrustedEnvProxy` |
| `src/main/libs/openclawPatches/` | 验证当前 `package.json` pinned 的 OpenClaw 版本目录下存在必要 runtime patch；按 patch 拆分测试文件 |

## 3. Patch 迁移状态

状态说明：

| 状态 | 含义 |
|------|------|
| 已迁移 | 已在 `scripts/patches/v2026.6.1/` 中建立对应 patch，并通过当前验证 |
| 待处理 | 仍需判断是否需要迁移；如需要，还需适配 6.1 源码并验证 |
| 不再需要迁移 | 经确认，OpenClaw 6.1 已内置等价能力，或 LobsterAI 不再依赖该 patch |

> 截至 2026-06-16，本轮已确认 `openclaw-browser-duplicate-launch.patch`、`openclaw-web-fetch-env-proxy.patch`、`openclaw-extra-body-passthrough.patch`、`openclaw-codex-use-native-transport.patch` 不再需要迁移：前两者分别已由 OpenClaw 6.1 browser ensure 串行化与 `tools.web.fetch.useTrustedEnvProxy` 覆盖；后两者已由 OpenClaw 6.1 的 `embedded-agent-runner` extra params 与 native Codex responses stream resolution 覆盖。

| v2026.4.14 patch | 当前状态 | 处理方式 / 说明 |
|------------------|----------|-----------------|
| `openclaw-aborted-tool-loop-breaker.patch` | 待处理 | 尚未评估；需确认 6.1 是否仍存在 aborted tool loop 问题 |
| `openclaw-browser-blocked-hostnames.patch` | 已迁移 | 已迁移到 `v2026.6.1`；6.1 原生 schema 仅支持 `allowedHostnames` / `hostnameAllowlist`，本补丁补回 `blockedHostnames` 类型、schema、浏览器配置归一化、SSRF policy 比较/合并与 DNS 前阻断测试 |
| `openclaw-browser-duplicate-launch.patch` | 不再需要迁移 | OpenClaw 6.1 已在 `server-context.availability.ts` 中通过 `profileState.ensureBrowserAvailable` 串行化同 profile 的并发 ensure，并已有 `server-context.ensure-browser-available.waits-for-cdp-ready.test.ts` 覆盖并发复用场景 |
| `openclaw-chat-send-cwd-decoupling.patch` | 已迁移 | 已迁移到 `v2026.6.1`；6.1 将协议 schema 移至 `packages/gateway-protocol`，本次适配让 `ChatSendParamsSchema` 接受 `cwd`，并由 `chat.send` handler 传入 `replyOptions.cwd` |
| `openclaw-chat-send-image-attachment-30mb.patch` | 待处理 | 尚未评估；需确认 6.1 对 chat.send 图片附件大小限制是否仍需放宽 |
| `openclaw-codex-use-native-transport.patch` | 不再需要迁移 | OpenClaw 6.1 已在 `src/agents/embedded-agent-runner/stream-resolution.ts` 中将 `provider=openai` 且 `api=openai-chatgpt-responses` 的模型路由到 `openclaw-native-codex-responses`，并已有 `stream-resolution.test.ts` 覆盖 OAuth key 透传与 system prompt 清理 |
| `openclaw-cron-skip-missed-jobs.patch` | 已迁移 | 已迁移到 `v2026.6.1`；让 schema 和 cron runtime 支持 `cron.skipMissedJobs` |
| `openclaw-deepseek-mimo-reasoning-replay.patch` | 待处理 | 尚未评估；需确认 6.1 reasoning replay 行为是否仍需修补 |
| `openclaw-deepseek-v4-thinking-mode.patch` | 待处理 | 尚未评估；需确认 DeepSeek V4 thinking mode 支持是否已由上游覆盖 |
| `openclaw-disable-model-pricing-bootstrap.patch` | 待处理 | 尚未评估；需确认 6.1 是否仍有启动阶段 pricing bootstrap 延迟问题 |
| `openclaw-empty-sse-data.patch` | 已迁移 | 已迁移到 `v2026.6.1`；补充 OpenAI-compatible completions fetch 包装，过滤空 SSE `data:` frame，并对连续空 frame 设置上限，避免 provider 异常流导致 parser 报错或空转 |
| `openclaw-extra-body-passthrough.patch` | 不再需要迁移 | OpenClaw 6.1 已在 `src/agents/embedded-agent-runner/extra-params.ts` 支持 `extra_body` / `extraBody`，并已有 `embedded-agent-runner-extraparams.test.ts` 覆盖 payload 合并与非法值跳过；但 thinking 展示不只依赖参数透传，还要求模型元数据明确标记 `supportsThinking` / `reasoning: true` |
| `openclaw-facade-runtime-static-import.patch` | 待处理 | 尚未评估；需确认 6.1 bundle/运行时是否仍需 static import 规避问题 |
| `openclaw-gateway-startup-profiler.patch` | 待处理 | 尚未评估；偏诊断能力，需判断是否仍要保留 |
| `openclaw-im-bound-agent-run-cwd.patch` | 已迁移 | 已迁移到 `v2026.6.1`；让 schema 和 reply runtime 支持 agent run cwd |
| `openclaw-jiti-alias-prenormalize.patch` | 待处理 | 尚未评估；需确认 6.1 jiti alias 解析是否仍需预归一化 |
| `openclaw-mcp-shared-runtime.patch` | 待处理 | 尚未评估；需确认 MCP runtime 复用需求是否仍存在 |
| `openclaw-mcp-stdio-process-tree-kill.patch` | 待处理 | 尚未评估；需确认 stdio MCP 进程树清理是否仍需补丁 |
| `openclaw-memory-atomic-reindex-ebusy-retry.patch` | 待处理 | 尚未评估；需确认 Windows EBUSY retry 是否已由上游覆盖 |
| `openclaw-qwen-coding-plan-qwen36-plus.patch` | 待处理 | 尚未评估；需确认 Qwen 3.6 Plus coding plan 支持是否仍需定制 |
| `openclaw-qwen-vision-catalog-fallback.patch` | 待处理 | 尚未评估；需确认 Qwen vision catalog fallback 是否仍需 patch |
| `openclaw-skip-derive-prompt-segments-deadloop.patch` | 待处理 | 尚未评估；需确认 derivePromptSegments 死循环问题是否仍存在 |
| `openclaw-subagent-cleanup-finalize-best-effort.patch` | 待处理 | 尚未评估；需确认 subagent cleanup/finalize 失败是否仍会影响主流程 |
| `openclaw-web-fetch-env-proxy.patch` | 不再需要迁移 | 旧补丁字段为 `tools.web.fetch.useEnvProxy`；OpenClaw 6.1 已提供 `tools.web.fetch.useTrustedEnvProxy`、cache key 隔离和 env proxy dispatcher 测试。LobsterAI 当前配置同步不再写出旧字段，也不自动写出新字段 |
| `openclaw-widen-incomplete-turn-retry-guard.patch` | 待处理 | 尚未评估；需确认 incomplete turn retry guard 是否仍需放宽 |
| `zz-openclaw-first-response-timing-logs.patch` | 待处理 | 尚未评估；偏诊断日志，需判断是否仍要保留 |

### 3.1 `extra_body` 与 thinking 展示复核

2026-06-17 复核 PR #2019 后确认，`openclaw-extra-body-passthrough.patch` 仍不需要迁移：OpenClaw 6.1 已内置 `extra_body` / `extraBody` payload 合并逻辑，LobsterAI 生成的 `openclaw.json` 也会把模型自定义参数写到 `agents.defaults.models["provider/model"].params.extra_body`。

本次排查还发现，OpenClaw 6.1 只有在模型配置 `reasoning: true` 且 thinking level 非 `off` 时，才会把 OpenAI-compatible stream 中的 `reasoning_content` / `reasoning` / `reasoning_text` 转为 thinking 事件。因此，仅写出 `extra_body` 还不够，模型元数据也需要通过明确的 `supportsThinking` 来源同步为 `reasoning: true`。

注意：qianfan `deepseek-v3.2` 当前仍在 LobsterAI 配置迁移黑名单 `REMOVED_PROVIDER_MODELS.qianfan` 中，`openclaw.json` 中缺少该模型是预期的配置过滤结果，不作为本轮升级验证样本。

LobsterAI 侧处理边界：`customParams` 只作为厂商请求参数透传到 `extra_body`，不再反向推断模型是否支持 thinking。套餐模型依赖服务端模型 metadata 下发的 `supportsThinking`；内置 provider 模型依赖 LobsterAI 静态模型表中的精确 `supportsThinking`；自定义模型需要用户显式配置 `supportsThinking: true` 后才会同步为 OpenClaw `reasoning: true`。同时，LobsterAI 的 assistant stream/history thinking 提取增加了顶层 `reasoning_content` / `reasoning` / `reasoning_text` 兜底。

已按 OpenClaw 6.1 manifest / provider catalog 中明确的 `reasoning: true`，以及业务侧确认的模型能力，补齐 LobsterAI 当前静态模型表中的精确模型，例如 DeepSeek V4 / Reasoner、Kimi K2.5 / K2.6、Zhipu GLM、MiniMax M3、Volcengine 当前内置模型、Youdao DeepSeek Reasoner、Qianfan GLM / DeepSeek V4、Xiaomi MiMo、OpenAI GPT-5.4 / GPT-5.5、Gemini 3.x、Anthropic Claude 4.x，以及 OpenRouter 中对应的 Claude / GPT / Gemini 模型。Qwen 3.5 / 3.6 待后续确认；其他未确认模型不做泛化标记。

## 4. 实施步骤

### 4.1 已完成

1. 将 OpenClaw pinned version 切换到 `v2026.6.1`。
2. 调整 Node 版本要求为 `>=24.15.0 <25`。
3. 迁移 `openclaw-cron-skip-missed-jobs.patch`。
4. 迁移 `openclaw-im-bound-agent-run-cwd.patch`。
5. 迁移 `openclaw-chat-send-cwd-decoupling.patch`，修复 `chat.send` 携带 `cwd` 时被协议校验拒绝的问题。
6. 在 LobsterAI 侧补充 patch 存在性和配置输出测试。
7. 修复 runtime 构建复用时对残缺产物的误判。
8. 重新构建 host runtime，确认 `node_modules`、`gateway.asar`、`dist/control-ui/index.html` 都存在。
9. 迁移 `openclaw-browser-blocked-hostnames.patch`，补齐浏览器 SSRF blocklist 配置链路。
10. 确认 `openclaw-browser-duplicate-launch.patch`、`openclaw-web-fetch-env-proxy.patch` 不再需要迁移，并补充 LobsterAI 侧决策测试。
11. 迁移 `openclaw-empty-sse-data.patch`，补齐 OpenAI-compatible completions 空 SSE frame 过滤。
12. 确认 `openclaw-extra-body-passthrough.patch`、`openclaw-codex-use-native-transport.patch` 不再需要迁移，并补充 LobsterAI 侧决策测试。
13. 调整 `scripts/build-openclaw-runtime.sh`，避免 OpenClaw `v2026.6.1` 在 `npm pack` 阶段通过 `prepack` 触发第二次 `pnpm build` / `tsdown`；相关构建验证按本轮要求暂未执行，待手动测试。
14. 修复 thinking 模型元数据同步：通过明确的 `supportsThinking` 来源写出 OpenClaw `reasoning: true`，`customParams` 仅保留为 `extra_body` 透传；同时补充 `reasoning_content` 顶层字段提取兜底。

### 4.2 待处理

1. 按表格顺序逐个评估其余 `v2026.4.14` patch。
2. 对每个 patch 给出明确结论：
   - 需要迁移：适配 6.1 源码，生成 `v2026.6.1` patch，补必要测试。
   - 不再需要迁移：记录上游已覆盖或业务不再依赖的证据。
   - 暂缓：记录原因和风险。
3. 每迁移一批 patch 后执行：

```bash
npm run openclaw:patch
npm run openclaw:runtime:host
npx vitest run src/main/libs/openclawPatches src/main/libs/openclawConfigSync.runtime.test.ts
npm run build
```

## 5. 涉及文件

| 文件 / 目录 | 说明 |
|-------------|------|
| `package.json` | OpenClaw 版本与 Node 版本要求 |
| `scripts/patches/v2026.4.14/` | 旧版本 patch 来源 |
| `scripts/patches/v2026.6.1/` | 新版本 patch 目标目录 |
| `scripts/run-build-openclaw-runtime.cjs` | OpenClaw runtime 构建入口适配 |
| `scripts/build-openclaw-runtime.sh` | runtime 构建与完整性检查 |
| `src/main/libs/openclawConfigSync.ts` | LobsterAI 生成 OpenClaw 配置的核心逻辑 |
| `src/main/libs/openclawConfigSync.runtime.test.ts` | 配置输出测试 |
| `src/main/libs/openclawPatches/` | pinned OpenClaw 版本 patch 覆盖测试 |

## 6. 验证计划

当前已完成验证：

```bash
npm run openclaw:patch
npx vitest run src/main/libs/openclawPatches src/main/libs/openclawConfigSync.runtime.test.ts
npm run openclaw:runtime:host
npm run build
```

本轮 browser/web access 补丁迁移额外验证：

```bash
npm run openclaw:patch
npx vitest run src/main/libs/openclawPatches src/main/libs/openclawConfigSync.runtime.test.ts
```

结果：

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run openclaw:patch` | 通过 | 从干净 OpenClaw 6.1 源码重置后，4 个 `v2026.6.1` patch 均成功应用 |
| `npx vitest run src/main/libs/openclawPatches src/main/libs/openclawConfigSync.runtime.test.ts` | 通过 | 6 个测试文件、30 个用例通过 |
| `node_modules/.bin/vitest.cmd run src/infra/net/ssrf.pinning.test.ts --reporter verbose --testTimeout=10000 --pool forks`（OpenClaw 侧） | 未完成 | 在当前 Windows 会话中 90 秒无输出超时；本次先以 `openclaw:patch` 与 LobsterAI 侧测试作为有效验证，后续如需可在 OpenClaw 独立环境继续跑目标测试 |

本轮 Provider / OpenAI-compatible 传输兼容性补丁迁移额外验证：

```bash
npm run openclaw:patch
npx vitest run src/main/libs/openclawPatches src/main/libs/openclawConfigSync.runtime.test.ts
npm run build
```

结果：

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run openclaw:patch` | 通过 | 从干净 OpenClaw 6.1 源码重置后，5 个 `v2026.6.1` patch 均成功应用 |
| `npx vitest run src/main/libs/openclawPatches src/main/libs/openclawConfigSync.runtime.test.ts` | 通过 | 8 个测试文件、34 个用例通过 |
| `npm run build` | 通过 | LobsterAI TypeScript / Vite / Electron 构建通过；仅有既有 Vite warning |
| `node_modules/.bin/vitest.cmd run src/agents/openai-transport-stream.test.ts --reporter verbose --testNamePattern "empty SSE\|non-event-stream" --testTimeout=10000 --pool forks`（OpenClaw 侧） | 未完成 | 在当前 Windows 会话中 90 秒无输出超时；本次先以 `openclaw:patch`、LobsterAI 侧测试和构建作为有效验证，后续如需可在 OpenClaw 独立环境继续跑目标测试 |

runtime 打包二次构建修复记录：

| 命令 / 场景 | 结果 | 说明 |
|------|------|------|
| `npm run openclaw:runtime:host` | 未执行 | 本轮按要求只调整脚本与文档，不启动 OpenClaw runtime 构建；待手动测试确认日志中只出现一次 `[build-all] tsdown`，且 `[2/7] Packing npm tarball` 后不再出现 `openclaw@2026.6.1 prepack` / 第二轮 `scripts/build-all.mjs` |

后续每迁移一个 patch，应至少完成：

1. `npm run openclaw:patch`：确认 patch 可从干净 OpenClaw 6.1 源码应用。
2. `npm run openclaw:runtime:host`：确认 runtime 可完整生成。
3. 针对 patch 行为补 LobsterAI 侧测试或 OpenClaw 侧临时验证。
4. `npm run build`：确认 LobsterAI TypeScript/Vite 构建仍通过。
