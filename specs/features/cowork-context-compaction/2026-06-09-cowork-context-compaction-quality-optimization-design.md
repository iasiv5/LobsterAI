# LobsterAI Cowork 上下文压缩质量优化设计文档

## 1. 概述

### 1.1 背景

`2026-05-08-cowork-context-compaction-design.md` 已完成 LobsterAI 对 OpenClaw 上下文压缩能力的产品接入：上下文使用量展示、手动压缩、自动压缩事件、maintenance/silent 消息过滤，以及压缩 retry 期间的运行态保护。

近期用户反馈：压缩后模型回复质量明显下降，感觉“大模型被搞傻了”。反馈中建议结合 RTK/插件能力，从“省 token”和“上下文维持”两个方向继续优化，后续也可考虑接入 claw3d 等更强能力。

本问题和第一版接入目标不同：第一版解决“压缩能不能触发、能不能展示、压缩期间 UI 是否正确”；本优化要解决“压缩后模型还能不能继续像压缩前一样理解任务”。

### 1.2 核心判断

压缩是有损过程。OpenClaw 默认 compaction summary 可以降低 token，但不一定保留 coding session 中最关键的可执行上下文，例如：

- 当前任务目标和完成标准。
- 用户明确约束和偏好。
- 已经尝试过的方案、失败原因和下一步计划。
- 最近修改的文件、函数、接口和配置。
- 工具结果中的具体错误、测试失败和日志片段。
- 本轮选择的 Kit/Skill/插件能力。
- 长任务中“正在做什么”和“不要重复做什么”。

因此，“压缩后变笨”大概率不是上下文圆环或 IPC 接入导致，而是模型压缩后只看到泛化摘要，缺少继续 coding 所需的结构化任务状态和可检索证据。

### 1.3 目标

1. 不替用户默认指定或切换 compaction model。
2. 在不改用户模型选择的前提下，提高压缩后任务连续性。
3. 让 LobsterAI 保存一份可控的任务连续性上下文，而不是完全依赖 OpenClaw summary。
4. 压缩后按需恢复关键原文证据，减少 summary 丢细节导致的退化。
5. 增加诊断能力，能判断一次压缩是成功、无 checkpoint、summary 过短，还是压缩后上下文仍超限。
6. 保持现有 OpenClaw compaction 接入和 UI 行为，避免大规模重写。

### 1.4 非目标

- 不默认设置 `agents.defaults.compaction.model` 为某个“更强模型”。
- 不默认替用户切换模型、provider 或 base URL。
- 不实现自定义模型能力评测或自动选择 compaction model。
- 不把完整历史重新塞回上下文。
- 不展示完整 compaction summary 给普通用户。
- 不把 OpenClaw assembled context 中的 `compactionSummary` 当成 LobsterAI 可见消息。
- 不把 RTK/RAG 作为第一步强依赖；第一阶段先做 continuity capsule 和诊断。

## 2. 什么能做，什么不能做

### 2.1 不能默认做

#### 不能默认指定更强的 compaction model

用户的模型是自定义的，LobsterAI 不知道哪个模型更适合压缩。强行把 `agents.defaults.compaction.model` 改成某个默认模型会带来问题：

- 用户可能没有该模型权限。
- 用户可能使用私有 provider 或内网模型。
- 用户可能希望所有推理都走同一个自定义模型。
- 不同 provider 的模型 ID、上下文窗口、价格和能力不可统一假设。
- 自动切模型可能破坏企业配置或审计预期。

因此该项只能作为后续高级配置：

- 用户显式选择“压缩模型”。
- 默认值为空，表示沿用 OpenClaw 当前策略。
- UI 必须说明这是可选高级项。

第一版优化不做该配置。

#### 不能默认降低未知模型 context window

沿用原设计：未知模型不贸然改小 context window，也不改变 OpenClaw 默认兜底策略。压缩质量优化应通过更好的上下文组织实现，而不是靠更早压缩。

### 2.2 能做且应该做

1. 修复 context maintenance 事件转发链路，让整理上下文状态稳定展示。
2. 在压缩完成后读取 checkpoint metadata 做诊断。
3. 为每个 Cowork session 维护 LobsterAI 自己的 continuity capsule。
4. 压缩后继续会话时，把 continuity capsule 注入为隐藏 bridge。
5. 压缩后对 coding session 自动补充轻量 workspace state。
6. 后续引入 RTK/RAG，从历史、工具结果、memory 和 diff 中检索相关原文片段。
7. 后续加入压缩质量审计，检查 summary/capsule 是否漏掉关键任务状态。

## 3. 用户场景

### 场景 1: 压缩后继续 coding

**Given** 用户在长 Cowork 任务中已经触发上下文压缩  
**When** 用户继续追问“继续刚才的实现”或“把测试也补上”  
**Then** 模型仍能知道当前任务目标、已修改文件、下一步计划和未解决问题  
**And** 不需要用户重新复述大量上下文

### 场景 2: 压缩摘要遗漏细节

**Given** OpenClaw compaction summary 只保留了泛化描述  
**When** 用户后续问题需要具体文件、错误或工具结果  
**Then** LobsterAI 可以通过 continuity capsule 和检索结果补回关键证据  
**And** 不把完整旧历史重新塞回上下文

### 场景 3: 压缩期间用户误判

**Given** OpenClaw 正在 memory flush、auto-compaction 或 retry  
**When** renderer 收到 context maintenance 状态  
**Then** 输入区和消息列表稳定展示 `正在整理上下文...`  
**And** 用户不会误以为任务已结束

### 场景 4: 定位压缩质量问题

**Given** 用户反馈压缩后质量下降  
**When** 开发者查看日志或诊断状态  
**Then** 可以看到本次压缩是否产生 checkpoint、token 是否下降、summary 是否为空或过短、reason 是 manual 还是 overflow retry  
**And** 日志不包含完整 prompt、完整模型回复、完整 summary 或 API key

## 4. 方案分层

### 4.1 第一阶段：链路和诊断

第一阶段目标是“知道发生了什么，并确保用户看得到整理上下文状态”。

#### FR-1: 补齐 contextMaintenance 转发链路

当前 OpenClaw runtime adapter 已 emit `contextMaintenance`，main process 也已监听 router 的 `contextMaintenance` 并转发 `cowork:stream:contextMaintenance`。

需要确保：

- `CoworkEngineRouter.bindRuntimeEvents()` 转发 runtime 的 `contextMaintenance`。
- renderer `coworkService` 收到后更新 `contextMaintenanceSessionIds`。
- `StreamingActivityBar` 优先显示 `coworkContextMaintenanceRunning`。

涉及文件：

- `src/main/libs/agentEngine/coworkEngineRouter.ts`
- `src/main/libs/agentEngine/coworkEngineRouter.test.ts`
- `src/main/main.ts`
- `src/renderer/services/cowork.ts`
- `src/renderer/components/cowork/CoworkSessionDetail.tsx`

#### FR-2: 压缩诊断 metadata

第二点本质是“安全结构化日志”，不是 UI 功能、不是新的持久化状态，也不改变 OpenClaw 的压缩行为。第一版只在压缩结束后补充可排查的元信息，让后续反馈能判断“有没有产生 checkpoint、summary 是否为空/过短、token 是否真的下降、是手动压缩还是自动 overflow/retry 压缩”。

在手动压缩和自动压缩完成后，尝试读取 OpenClaw checkpoint metadata：

- `sessions.compaction.list`
- `sessions.compaction.get`

记录安全诊断字段：

```ts
type ContextCompactionDiagnostic = {
  sessionId: string;
  sessionKey?: string;
  mode: 'manual' | 'auto';
  reason?: string;
  checkpointId?: string;
  checkpointCreatedAt?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  summaryChars?: number;
  hasSummary: boolean;
  compacted?: boolean;
  updatedAt: number;
};
```

日志规则：

- 可以记录 `summaryChars`、`tokensBefore`、`tokensAfter`、`reason`、`checkpointId`。
- 不记录完整 summary。
- 不记录完整 prompt、完整模型回复、工具结果正文或 secret。
- warn/error 必须包含 error 对象作为最后一个参数。

状态保存：

- 第一版只输出安全结构化日志，不写数据库，不增加 renderer 状态。
- 如果后续要 UI 展示最近压缩诊断，再考虑 SQLite schema。

### 4.2 第二阶段：Continuity Capsule

第二阶段目标是“压缩后仍有任务连续性”。

#### FR-3: 定义 LobsterAI continuity capsule

为 Cowork session 维护一份结构化任务状态：

```ts
type CoworkContinuityCapsule = {
  sessionId: string;
  updatedAt: number;
  source: 'pre_compaction' | 'post_compaction' | 'post_run' | 'manual';
  currentGoal?: string;
  userConstraints: string[];
  keyFiles: Array<{
    path: string;
    reason?: string;
  }>;
  keySymbols: Array<{
    name: string;
    file?: string;
    reason?: string;
  }>;
  decisions: string[];
  completedSteps: string[];
  pendingSteps: string[];
  recentFailures: Array<{
    command?: string;
    summary: string;
  }>;
  validationState?: string;
  activeCapabilities: Array<{
    kind: 'skill' | 'kit' | 'mcp' | 'tool';
    id: string;
    name?: string;
  }>;
  openQuestions: string[];
};
```

生成原则：

- 只保存任务状态，不保存大段聊天。
- 优先保留文件路径、函数名、命令、错误摘要、决策和 TODO。
- 不保存 secret、token、完整日志、完整 tool result。
- 单个 capsule 有上限，例如 6k-10k 字符。
- 更新是覆盖式，不无限增长。

#### FR-4: Capsule 生成时机

第一版生成时机：

1. 手动 compact 前。
2. 自动 compaction `phase=start` 或 `phase=end completed=true` 后。
3. 每次 session complete 后低频更新一次。

如果 compact 前生成失败：

- 不阻塞 OpenClaw 原始 compaction。
- 记录 warn。
- 后续仍可用 post-run 或 checkpoint summary 生成。

#### FR-5: Capsule 生成方式

第一版不引入额外模型选择。

候选实现：

1. 规则提取：
   - 从当前 session messages 提取最近 user/assistant。
   - 从 tool_use/tool_result metadata 提取工具名、文件路径、命令。
   - 从 selected text、Kit/Skill metadata 提取能力引用。
   - 从 assistant message meta 提取 model/token/agent 信息。
2. 轻量 LLM 生成：
   - 使用当前会话同一个模型。
   - prompt 明确要求输出 JSON。
   - 失败时退回规则提取。

第一版建议：先规则提取 + 简短模板，不新增 LLM 调用，降低成本和不确定性。

#### FR-6: 压缩后注入 capsule bridge

在 `OpenClawRuntimeAdapter` 构造继续会话 prompt 时，如果 session 存在有效 capsule，则在当前 user request 前注入隐藏 bridge：

```text
[LobsterAI continuity context after compaction]
Use this state to preserve task continuity. It may be more important than generic old-chat summaries.

Current goal:
...

Key files:
- ...

Pending steps:
- ...

Recent failures:
- ...
```

要求：

- 不作为用户可见消息展示。
- 不写入普通聊天文本，避免污染 UI。
- 不覆盖用户当前请求。
- 用户当前请求仍放在最后。
- 如果没有发生过压缩，也可以不注入，避免日常上下文变重。

涉及文件：

- `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- 可新增 `src/main/libs/agentEngine/coworkContinuityCapsule.ts`
- 可新增相关 `.test.ts`

### 4.3 第三阶段：Workspace Rehydration

第三阶段目标是“压缩后自动找回代码现场”。

#### FR-7: 压缩后首轮补充轻量 workspace state

对本地 coding session，压缩后的下一轮可补充：

- `git status --short` 摘要。
- 最近 touched files 列表。
- 当前 session 中工具修改过的文件列表。
- 最近失败命令摘要。
- 最近测试命令和结果摘要。

第一版不自动运行昂贵命令，不读取大文件。

数据来源优先级：

1. LobsterAI 已记录的 tool_use/tool_result metadata。
2. session message 中的文件路径和 diff 信息。
3. 轻量 shell 命令，后续再评估是否自动运行。

注入形式：

```text
[LobsterAI workspace state]
Recently touched files:
- src/...

Recent validation:
- npm test -- xxx failed: ...
```

### 4.4 第四阶段：RTK/RAG 检索

第四阶段目标是“按需恢复被压缩掉的原文证据”。

#### FR-8: 检索源

可索引的数据：

- Cowork user/assistant messages。
- tool_use/tool_result 的安全摘要。
- compaction checkpoint summary。
- continuity capsule。
- memory daily file / MEMORY.md。
- 关键文件 diff 或片段。
- Kit/Skill/插件 metadata。

#### FR-9: 检索策略

当 session 已发生压缩后，继续会话时：

1. 使用当前 user prompt + capsule currentGoal + pendingSteps 作为 query。
2. 检索 top-K 片段。
3. 控制总 token，例如 4k-8k。
4. 注入 `[Relevant pre-compaction context]`。
5. 不注入低分片段。

可以先用简单词法检索或 SQLite FTS，后续接 embedding/RTK。

#### FR-10: RTK/插件能力边界

RTK/插件不能替代 continuity capsule：

- capsule 保存“任务状态”。
- 检索保存“证据原文”。

两者同时存在时，prompt 顺序建议：

1. system instructions
2. selected Kit/Skill routing
3. continuity capsule
4. relevant retrieved evidence
5. current user request

## 5. 与现有 OpenClaw 能力的关系

### 5.1 OpenClaw compaction summary

继续使用 OpenClaw 原生 compaction，不替换它。

LobsterAI 增加的 continuity capsule 是补充层：

- OpenClaw summary 负责压缩旧对话。
- LobsterAI capsule 负责保留 coding 任务状态。
- RAG evidence 负责按需找回原文细节。

### 5.2 OpenClaw checkpoint API

已有可用 API：

- `sessions.compaction.list`
- `sessions.compaction.get`

当前 fork bridge 已使用 checkpoint summary。优化中可复用相关逻辑，但不要把 fork bridge 和同 session post-compaction bridge 混在一起。

建议拆出通用 helper：

```ts
getLatestCompactionCheckpoint(sessionId, beforeCreatedAt?)
```

fork 和诊断都复用该 helper。

### 5.3 OpenClaw config

第一版不修改：

- `agents.defaults.compaction.model`
- 未知模型默认 context window
- provider 配置

后续高级设置可选：

- 用户手动选择 compaction model。
- 用户手动设置 keep recent token 策略。
- 用户手动设置是否启用 continuity capsule / retrieval。

## 6. 数据与持久化

### 6.1 第一版持久化策略

建议第一版不新增 SQLite schema，先把 capsule 作为隐藏 system message 持久化在 cowork messages 中，类似 fork compaction summary：

```ts
metadata: {
  kind: 'context_continuity_capsule',
  hidden: true,
  source: 'pre_compaction',
  compactedAt: number,
  checkpointId?: string,
}
```

优点：

- fork、导出、历史进入时自然跟随 session。
- 不新增 DB migration。
- 可复用现有 message persistence。

注意：

- UI 不展示该消息。
- history reconcile 不应把它误删。
- fork 时可选择带上最新 capsule。

如果隐藏 system message 风险较大，备选方案是在 `cowork_sessions` metadata 中存 JSON，但需要 schema 或 store 字段扩展。

### 6.2 新增常量

遵守仓库字符串常量规范，不使用多处裸字符串。

建议扩展：

- `src/common/coworkSystemMessages.ts`
  - `CoworkSystemMessageKind.ContextContinuityCapsule`

如果新增 source/status，也用 `as const` 对象定义。

## 7. 实现计划

### Phase 0: 已发现的小修

- 补齐 `CoworkEngineRouter` 的 `contextMaintenance` 转发。
- 增加 router 单测。

该项是运行态显示修复，不是压缩质量主体。

### Phase 1: 压缩诊断

涉及文件：

- `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- `src/main/libs/agentEngine/openclawRuntimeAdapter.test.ts`

任务：

1. 抽出 checkpoint lookup helper。
2. manual compact 后读取 checkpoint metadata。
3. auto compaction completed 后读取 checkpoint metadata。
4. 输出安全诊断日志。
5. 增加测试覆盖：
   - checkpoint 有 summary。
   - checkpoint 无 summary 但可 get。
   - checkpoint lookup 失败不影响主流程。

### Phase 2: Continuity Capsule MVP

涉及文件：

- `src/common/coworkSystemMessages.ts`
- `src/main/libs/agentEngine/coworkContinuityCapsule.ts`
- `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- `src/main/coworkStore.ts`
- 相关测试文件

任务：

1. 新增 system message kind。
2. 实现规则提取 capsule。
3. compaction 前或后写入隐藏 capsule message。
4. `buildBridgePrefix()` 或相邻 prompt builder 注入最新 capsule。
5. UI/message 渲染过滤隐藏 capsule。
6. 测试覆盖：
   - capsule 包含关键文件、pending steps、recent failures。
   - capsule 不展示在 UI 普通消息中。
   - post-compaction continue prompt 包含 capsule bridge。
   - 无 capsule 时行为不变。

### Phase 3: Workspace State MVP

任务：

1. 从 tool metadata/message 中提取 touched files。
2. 从最近 tool result 中提取 validation summary。
3. 注入轻量 workspace state。
4. 不自动运行昂贵命令。

### Phase 4: RAG/RTK

任务：

1. 设计消息和工具结果的索引结构。
2. 先接 SQLite FTS 或轻量 lexical retrieval。
3. 后续接 embedding/RTK 插件。
4. 对 post-compaction continuation 启用 top-K evidence injection。

## 8. Prompt 设计草案

### 8.1 Capsule bridge

```text
[LobsterAI continuity context after context compaction]
This is a compact task-state record maintained by LobsterAI. Use it to preserve continuity after previous chat history was compressed. Prefer concrete file paths, decisions, failures, and pending steps from this section over vague assumptions.

Current goal:
{currentGoal}

User constraints:
- {constraint}

Key files and symbols:
- {file}: {reason}
- {symbol} ({file}): {reason}

Decisions:
- {decision}

Completed:
- {completedStep}

Pending:
- {pendingStep}

Recent failures or validation:
- {command}: {summary}

Active capabilities:
- {kind}:{id} {name}

Open questions:
- {question}
```

### 8.2 Capsule extraction prompt（后续可选）

如果后续引入 LLM 生成 capsule，prompt 必须要求结构化 JSON，并强调：

- 保留具体文件路径、函数名、命令、错误摘要。
- 不要写泛泛总结。
- 不要存 secret。
- 不要编造不存在的信息。
- 如果不确定，放入 `openQuestions`。

第一版不依赖该 LLM prompt。

## 9. 验收标准

### 9.1 功能验收

- context maintenance 状态能从 runtime 传到 renderer。
- 手动 compact 后有安全诊断日志。
- 自动 compaction completed 后有安全诊断日志。
- 压缩后继续会话时，prompt 中包含 LobsterAI continuity capsule。
- UI 不展示 hidden capsule。
- 未发生压缩的普通会话 prompt 不额外变重。
- 用户模型配置不被自动修改。

### 9.2 质量验收

构造长 coding session：

1. 用户要求修改 A/B/C 文件。
2. 工具运行中产生一次失败测试。
3. assistant 形成下一步计划。
4. 触发手动或自动压缩。
5. 用户发送“继续”。

期望：

- 模型能说出下一步要改哪些文件。
- 模型不重复已经完成的步骤。
- 模型能引用最近失败测试或错误摘要。
- 模型知道用户之前的强约束。

### 9.3 回归验收

- `npm test -- coworkEngineRouter`
- `npm test -- openclawRuntimeAdapter`
- `npm test -- coworkStore`
- `npx tsc -p electron-tsconfig.json --noEmit`
- `npx tsc -p tsconfig.json --noEmit`

## 10. 风险与缓解

### 风险 1: Capsule 本身过长

缓解：

- 字符上限。
- 每类字段数量上限。
- 优先保留 pending、failures、keyFiles。

### 风险 2: Capsule 过期

缓解：

- 每次 complete 或 compaction 更新。
- 注入时标记 `updatedAt`。
- 如果 session 后续状态变化，覆盖旧 capsule。

### 风险 3: Capsule 编造信息

缓解：

- 第一版规则提取优先。
- LLM 生成时必须允许 `openQuestions`，禁止猜测。
- 只从已有消息、metadata、工具结果摘要中提取。

### 风险 4: 隐藏消息污染 history reconcile

缓解：

- 明确 metadata kind。
- reconcile 和 render 都识别隐藏 capsule。
- 测试 hidden system message 在 fork 和 history reload 中的行为。

### 风险 5: 检索注入带来 prompt injection

缓解：

- 检索内容标记为 untrusted evidence。
- 不把旧 tool result 当作新指令。
- 优先注入文件路径、错误和事实摘要，不注入大段任意文本。

## 11. 开放问题

1. Capsule 是否用隐藏 system message 持久化，还是扩展 session metadata？
2. Capsule 是否只在发生 compaction 后注入，还是长任务 warning/danger 时也注入？
3. 第一版是否允许执行轻量 `git status --short`，还是只从已有工具记录提取 workspace state？
4. RAG 第一版使用 SQLite FTS、现有 embedding 配置，还是等待 RTK 插件接口稳定？
5. 是否需要在设置中暴露“启用压缩连续性增强”开关？

## 12. 结论

本优化不应从“替用户选更强压缩模型”开始。由于 LobsterAI 支持自定义模型和 provider，默认切换 compaction model 不可靠也不合适。

推荐路线：

1. 先补齐运行态链路和压缩诊断。
2. 再做 LobsterAI 自己的 continuity capsule。
3. 然后补 workspace rehydration。
4. 最后接 RTK/RAG 检索，把被压缩掉的关键原文按需找回。

这条路线可以在不改变用户模型选择的前提下，改善压缩后的任务连续性和模型回复质量。
