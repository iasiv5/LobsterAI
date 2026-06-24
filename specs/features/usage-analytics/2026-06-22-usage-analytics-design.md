# LobsterAI 产品使用日志上报设计文档

## 1. 概述

### 1.1 问题/背景

LobsterAI 需要增加产品使用日志上报能力，帮助项目维护者了解应用安装和功能使用情况，为功能优化、兼容性改进和开发优先级提供数据依据。

计划关注的数据包括用户选择和使用的技能、MCP、专家套件、模型来源与模型类型，以及其他核心功能的使用情况。具体事件名称、触发时机和业务参数尚未确定，后续将在本文中逐步补充。

本阶段先建立独立、统一的日志请求入口，集中处理日志服务地址、通用参数、用户标识、时间戳和网络请求，避免各业务模块自行拼接和发送日志。

### 1.2 目标

1. 提供统一的有道 Analyzer 日志上报方法。
2. 集中维护日志请求地址和 `_npid`、`_ncat` 等通用参数。
3. 自动补充当前登录用户的 `yid`、事件发生时间戳和基础环境参数。
4. 允许业务模块传入 `action` 和事件特有参数。
5. 日志上报失败不能影响应用原有功能。
6. 在设置中提供用户可主动关闭的使用统计开关。
7. 为后续增加具体功能事件保留统一扩展入口。

### 1.3 非目标

当前阶段不包含以下内容：

- 除计划模式开启事件外，不在其他页面或功能中添加日志事件。
- 不确定技能、MCP、专家套件、模型和其他后续功能的事件命名与参数规范。
- 不实现请求队列、批量发送、失败重试、离线缓存或频率限制。
- 不实现安装 ID、匿名 ID 或跨会话用户行为分析。
- 不上传对话内容、文件内容、文件路径、密钥或其他用户业务数据。

## 2. 当前实现

### 2.1 文件位置

日志请求实现在：

```text
src/renderer/services/logReporter.ts
```

对应单元测试位于：

```text
src/renderer/services/logReporter.test.ts
```

业务调用方统一通过 `reportYdAnalyzer()` 发送事件。当前已接入计划模式、应用启动、技能、MCP、专家套件、模型选择、设置页和 IM 机器人等入口；具体事件列表见下文 2.4。

### 2.2 日志服务配置

当前请求地址和通用参数为：

```typescript
export const LogReporterEndpoint = {
  YoudaoAnalyzer: 'https://rlogs.youdao.com/rlog.php',
} as const;

export const LogReporterProduct = {
  LobsterAI: 'wisdom',
} as const;

export const LogReporterCategory = {
  Actions: 'actions',
} as const;

export const LogReporterActionPrefix = {
  LobsterAI: 'lobsterai_',
} as const;
```

所有 `action` 必须以 `lobsterai_` 开头。日志模块会拒绝发送不符合该命名规则的事件，避免不同业务模块产生无法统一检索的事件名称。

### 2.3 参数构建

`buildLogUrl()` 使用 `URL` 和 `URLSearchParams` 生成 GET 请求地址。最终参数由以下部分组成：

| 参数 | 来源 | 说明 |
|------|------|------|
| `_npid` | 通用配置 | 产品 ID，当前为 `wisdom` |
| `_ncat` | 通用配置 | 日志分类，当前为 `actions` |
| `action` | 业务调用方 | 事件名称，不能为空且必须以 `lobsterai_` 开头 |
| `app_version` | Electron 应用信息 | 当前应用版本；首次上报前异步读取并缓存，读取失败时为空字符串 |
| `os_platform` | Preload 暴露的运行环境 | 当前系统平台，例如 `darwin`、`win32`、`linux` |
| `os_arch` | Preload 暴露的运行环境 | 当前系统架构，例如 `arm64`、`x64` |
| `language` | 应用配置 | 当前应用语言 |
| `uuid` | 本地安装 ID | 复用现有 `installation_uuid`，未登录时也可用于安装维度统计；读取失败时不发送 |
| `firstKeyfrom` | 渠道归因 | 复用现有首次渠道归因；读取失败时不发送 |
| `latestKeyfrom` | 渠道归因 | 复用现有最近渠道归因；读取失败时不发送 |
| `is_logged_in` | Redux 登录态 | 当前是否存在登录用户 `yid` |
| `log_Usid` | Redux 登录态 | 当前用户的 `yid`，未登录时为空字符串 |
| `uts` | 日志模块 | `Date.now()` 生成的毫秒时间戳 |
| 其他参数 | 业务调用方 | 当前事件特有的字符串、数字或布尔值参数 |

值为 `null` 或 `undefined` 的可选参数不会加入请求地址。

### 2.4 事件定义

所有事件名称通过 `action` 字段上报，命名统一使用 `lobsterai_` 前缀。已实现和规划中的事件不上传 API Key、MCP env/header、文件路径、对话内容或本地日志内容。涉及自定义技能、MCP、专家套件和模型时，当前仅上报 ID、名称、来源、类型和数量等结构化信息。

#### 2.4.1 `lobsterai_plan_mode_enabled`

- 状态：已实现。
- 触发时机：用户在输入框工具菜单中主动开启计划模式。关闭计划模式不发送。
- 事件含义：统计计划模式开启行为。
- 业务参数：
  - `entry`：string，触发入口。当前固定为 `prompt_tools_menu`，表示用户从输入框工具菜单开启计划模式。

#### 2.4.2 `lobsterai_app_started`

- 状态：已实现。
- 触发时机：Renderer 初始化完成并进入 shell ready 后发送一次。
- 事件含义：统计应用启动和活跃安装。
- 业务参数：
  - `providerModelCount`：number，Renderer 初始化阶段加载到的用户自配模型数量，用于观察本地模型配置覆盖情况。
  - `hasLoggedInUser`：boolean，启动完成时本地 Redux 登录态中是否存在用户 `yid`。该字段只表示启动时登录态快照，不替代通用参数 `is_logged_in`。

#### 2.4.3 `lobsterai_skill_enabled`

- 状态：已实现。
- 触发时机：用户成功启用技能时发送。关闭技能不发送，启用失败不发送。
- 事件含义：统计技能启用情况。
- 业务参数：
  - `skillId`：string，被启用技能的稳定 ID。
  - `skillName`：string，被启用技能的展示名称。
  - `skillSource`：string，技能来源分类。当前取值为 `built_in`、`official` 或 `custom`。
  - `isBuiltIn`：boolean，是否为应用内置技能。
  - `isOfficial`：boolean，是否为官方技能。
  - `version`：string，技能版本；缺失时不发送。

#### 2.4.4 `lobsterai_mcp_enabled`

- 状态：已实现。
- 触发时机：用户成功启用 MCP 服务时发送。关闭 MCP 不发送，启用失败不发送。
- 事件含义：统计 MCP 使用情况。
- 业务参数：
  - `mcpId`：string，被启用 MCP 服务的稳定 ID。
  - `mcpName`：string，被启用 MCP 服务的展示名称。
  - `mcpSource`：string，MCP 来源分类。当前取值为 `built_in`、`marketplace` 或 `custom`。
  - `registryId`：string，MCP 市场/注册表 ID；自定义 MCP 缺失时不发送。
  - `transportType`：string，MCP 传输类型，当前为 `stdio`、`sse` 或 `http`。
  - `isBuiltIn`：boolean，是否为内置 MCP。
- 隐私边界：不上传 MCP `command`、`args`、`env`、`url`、`headers` 等配置内容。

#### 2.4.5 `lobsterai_expert_kit_selected`

- 状态：已实现。
- 触发时机：用户在输入框专家套件菜单中选择套件时发送。取消选择不发送。
- 事件含义：统计专家套件选择情况。
- 业务参数：
  - `kitId`：string，被选择专家套件的稳定 ID。
  - `kitName`：string，专家套件展示名称；无法从市场元数据解析时不发送。
  - `kitSource`：string，专家套件来源分类。当前取值为 `lobsterai-kits` 或 `installed`。
  - `isInstalled`：boolean，当前本地是否已安装该专家套件。
  - `skillCount`：number，该专家套件关联的技能数量；无法解析时不发送。
  - `mcpServerCount`：number，该专家套件关联的 MCP 服务数量；无法解析时不发送。
  - `connectorCount`：number，该专家套件关联的连接器数量；无法解析时不发送。

#### 2.4.6 `lobsterai_model_selected`

- 状态：已实现。
- 触发时机：用户成功切换当前会话模型，或成功保存 Agent 模型选择后发送。切换/保存失败不发送。
- 事件含义：统计模型选择情况。
- 业务参数：
  - `modelId`：string，被选择模型的 ID。
  - `modelName`：string，被选择模型的展示名称。
  - `modelSource`：string，模型来源分类。当前取值为 `package` 或 `custom`；`package` 表示套餐/服务端模型，`custom` 表示用户自配模型。
  - `providerKey`：string，模型所属 provider 的配置 key；缺失时不发送。
  - `provider`：string，模型所属 provider 的展示名称；缺失时不发送。
  - `selectorGroup`：string，模型选择器分组，当前为 `server` 或 `user`。
  - `target`：string，本次选择作用范围。`session` 表示切换当前会话模型，`agent` 表示保存 Agent 模型。
  - `agentId`：string，当前 Agent ID。
  - `sessionId`：string，当前会话 ID；仅 `target=session` 时发送。
  - `isServerModel`：boolean，是否为服务端套餐模型。
- 隐私边界：不上传 provider API Key、base URL、鉴权类型或其他模型凭证配置。

#### 2.4.7 `lobsterai_general_setting_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> 通用」修改设置并成功生效后发送。未保存、保存失败或系统 API 调用失败不发送。
- 事件含义：统计通用设置项的实际变更情况。
- 生效语义：
  - `autoLaunch` 和 `preventSleep` 是立即生效项，应在对应系统 API 返回成功后发送。
  - `language`、`useSystemProxy`、`sqliteAutoBackupEnabled`、`taskCompletionNotificationsEnabled`、`skipMissedJobs` 等配置项应在设置页保存成功后，根据保存前后的 diff 逐项发送。
  - `usageAnalyticsEnabled=false` 不通过该事件发送，避免用户选择关闭使用统计后仍继续上报关闭动作。
- 业务参数：
  - `settingKey`：string，变更的通用设置项 key。当前规划取值包括 `language`、`autoLaunch`、`preventSleep`、`useSystemProxy`、`sqliteAutoBackupEnabled`、`taskCompletionNotificationsEnabled`、`skipMissedJobs`。
  - `settingValue`：string 或 boolean，变更后的基础值。布尔设置使用 `true` / `false`；语言使用 `zh` / `en`。
  - `previousValue`：string 或 boolean，变更前的基础值；无法可靠获取时不发送。
  - `source`：string，触发来源。当前固定为 `settings_general`。
- 暂不记录：快捷键具体组合、代理地址、API Key、base URL、文件路径等可能包含用户偏好或敏感信息的内容。

#### 2.4.8 `lobsterai_usage_analytics_enabled`

- 状态：已实现。
- 触发时机：用户在「设置 -> 通用」中将「帮助改进 LobsterAI」从关闭重新开启，并成功保存后发送。
- 事件含义：统计用户主动重新开启基础使用统计的情况。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_general`。
- 隐私边界：
  - 用户将 `usageAnalyticsEnabled` 从开启改为关闭时不发送任何日志请求。
  - 重新开启事件只在保存成功后发送，不在用户点击但未保存时发送。

#### 2.4.9 `lobsterai_appearance_setting_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> 外观」修改设置并保存成功后，根据保存前后的 diff 逐项发送。未保存或保存失败不发送。
- 事件含义：统计外观设置项的实际变更情况。
- 业务参数：
  - `settingKey`：string，变更的外观设置项 key。当前取值包括 `theme`、`themeId`。
  - `settingValue`：string，变更后的基础值。`theme` 当前为 `light`、`dark` 或 `system`；`themeId` 为主题色 ID，例如 `classic-light`、`midnight`、`cyber`。
  - `previousValue`：string，变更前的基础值；无法可靠获取时不发送。
  - `source`：string，触发来源。当前固定为 `settings_appearance`。
- 隐私边界：不上传主题 token、颜色值、CSS 变量或其它样式细节。

#### 2.4.10 `lobsterai_agent_engine_setting_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> Agent 引擎」相关配置保存成功后，根据保存前后的 diff 逐项发送。未保存或保存失败不发送。
- 事件含义：统计 Agent 引擎相关设置的实际变更情况。
- 业务参数：
  - `settingKey`：string，变更的 Agent 引擎设置项 key。当前取值包括 `agentEngine`、`openClawSessionKeepAlive`。
  - `settingValue`：string，变更后的基础值。
  - `previousValue`：string，变更前的基础值；无法可靠获取时不发送。
  - `source`：string，触发来源。当前固定为 `settings_agent_engine`。
- 暂不记录：OpenClaw gateway URL、本地 runtime 路径、配置文件路径、工作区路径、token、key 或 env。
- 说明：`skipMissedJobs` 当前归入「设置 -> 通用」的 `lobsterai_general_setting_changed`，避免同一次保存重复上报。

#### 2.4.11 `lobsterai_agent_engine_maintenance_action`

- 状态：已实现。
- 触发时机：用户在「设置 -> Agent 引擎」主动执行维护动作，并且动作完成后发送。用户取消文件选择等未完成动作不发送。
- 事件含义：统计 Agent 引擎维护动作的结果。
- 业务参数：
  - `actionType`：string，维护动作类型。当前取值包括 `repair_gateway_state`、`backup_data`、`restore_data`。
  - `result`：string，动作结果。当前取值包括 `success`、`failed`、`started`。
  - `errorCode`：string，失败分类；无法识别时为 `unknown`。仅失败时发送。
  - `sizeBytes`：number，备份文件大小；仅 `backup_data` 成功且可获取时发送。
  - `source`：string，触发来源。当前固定为 `settings_agent_engine`。
- 隐私边界：不上传备份文件路径、导入文件路径、OpenClaw gateway URL、错误详情文本或本地配置内容。

#### 2.4.12 `lobsterai_custom_model_settings_saved`

- 状态：已实现。
- 触发时机：用户在「设置 -> 自定义模型」修改 provider 或模型配置，并成功保存后发送；删除自定义 provider 这类即时持久化动作在确认删除且持久化成功后发送。未保存、保存失败或仅切换 provider tab 不发送。
- 事件含义：用较粗粒度统计用户自定义模型配置情况，避免对每个输入框或每个模型编辑动作做过细埋点。
- 发送口径：
  - 根据保存前后的 `providers` 配置做 diff，仅当 provider 开关、API 协议、Coding Plan 开关、鉴权类型、provider 数量或模型数量发生变化时发送。
  - 同一次保存只发送一条摘要事件，不按 provider 或 model 逐条发送。
  - 自定义 provider 的新增、删除、启用状态变化，都归入该摘要事件。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_model`。
  - `changedProviderCount`：number，本次保存中发生配置变化的 provider 数量。
  - `enabledProviderCount`：number，保存后的已启用 provider 数量。
  - `customProviderCount`：number，保存后的自定义 provider 数量，例如 `custom_0`、`custom_1` 等。
  - `enabledCustomProviderCount`：number，保存后的已启用自定义 provider 数量。
  - `modelCount`：number，保存后的模型总数，仅统计当前 providers 配置中的模型条目数量。
  - `customProviderModelCount`：number，保存后的自定义 provider 模型数量。
  - `hasLocalProviderEnabled`：boolean，保存后是否启用了本地模型 provider，例如 `ollama` 或 `lm-studio`。
  - `hasCodingPlanEnabled`：boolean，保存后是否存在已开启 Coding Plan 的 provider。
  - `changedKeys`：string，本次变化类型的去重列表，使用逗号分隔。当前规划取值包括 `provider_enabled`、`provider_count`、`api_format`、`coding_plan`、`auth_type`、`model_count`。
- 隐私边界：
  - 不上传 API Key、OAuth token、base URL、provider displayName、模型名称、模型 ID、customParams、导入/导出文件名或本地路径。
  - 不上传具体自定义 provider 编号列表，只上传数量和是否启用等摘要字段。
  - `modelCount` 仅用于统计配置规模，不表达用户是否实际使用某个模型；实际选择模型仍以 `lobsterai_model_selected` 为准。

#### 2.4.13 `lobsterai_custom_model_connection_tested`

- 状态：已实现。
- 触发时机：用户在「设置 -> 自定义模型」点击测试连接，并得到测试结果后发送。缺少 API Key、缺少模型导致测试无法发起时也发送失败分类；用户未点击测试不发送。
- 事件含义：统计自定义模型 provider 的连接可用性和配置成功率。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_model`。
  - `providerKey`：string，被测试 provider 的配置 key，例如 `openai`、`anthropic`、`custom_0`、`ollama`。
  - `providerKind`：string，provider 类型。当前规划取值为 `builtin`、`custom`、`local`。
  - `apiFormat`：string，测试时使用的 API 协议。当前规划取值为 `openai`、`anthropic`、`gemini`。
  - `result`：string，测试结果。当前规划取值为 `success`、`failed`。
  - `failureReason`：string，失败分类。当前规划取值包括 `missing_api_key`、`missing_model`、`http_error`、`network_error`、`unknown`；仅失败时发送。
  - `statusCode`：number，HTTP 失败时的状态码；无法获取时不发送。
- 隐私边界：
  - 不上传测试请求 URL、API Key、请求头、请求体、模型名称、模型 ID 或服务端错误详情。
  - 不上传完整错误 message，因为供应商错误内容可能包含地址、账号、token 片段或其他敏感信息。

#### 2.4.14 `lobsterai_im_settings_saved`

- 状态：已实现。
- 触发时机：用户在「设置 -> IM 机器人」保存平台配置成功后发送；微信扫码登录成功并持久化配置后、企业微信快速配置成功并持久化配置后，也按该事件发送。保存失败不发送。
- 事件含义：统计 IM 机器人平台配置的使用情况和配置规模，不记录具体凭证或会话信息。
- 发送口径：
  - 单平台保存成功发送一条事件。
  - 多实例平台保存成功发送平台摘要，不按每个实例逐条发送。
  - 微信扫码登录和企业微信快速配置属于自动填充并保存配置，成功后发送一条事件。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_im`。
  - `platform`：string，IM 平台，例如 `weixin`、`dingtalk`、`feishu`、`telegram`、`discord`、`email`。
  - `platformKind`：string，平台形态。当前取值为 `single_instance` 或 `multi_instance`。
  - `enabled`：boolean，保存后的平台是否启用。多实例平台表示是否存在已启用实例。
  - `instanceCount`：number，多实例平台保存后的实例数量；单实例平台不发送。
  - `enabledInstanceCount`：number，多实例平台保存后的启用实例数量；单实例平台不发送。
  - `changedKeys`：string，本次变化类型的去重列表，使用逗号分隔。当前规划取值包括 `enabled`、`instance_count`、`dm_policy`、`agent_binding`、`reply_mode`、`connection_mode`、`credential_state`、`config`。
  - `hasAgentBinding`：boolean，保存后该平台是否配置了非默认 Agent 绑定。
- 隐私边界：
  - 不上传 bot token、app secret、secret、webhook URL、邮箱地址、allowFrom、群 ID、会话 ID、用户 ID、账号 ID、bot username、实例名称或错误详情。
  - `credential_state` 只表示凭证配置状态发生变化，不上传任何凭证内容。

#### 2.4.15 `lobsterai_im_gateway_toggled`

- 状态：已实现。
- 触发时机：用户在「设置 -> IM 机器人」启动或停止某个平台网关并得到结果后发送。
- 事件含义：统计 IM 网关启停使用情况和失败率。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_im`。
  - `platform`：string，被操作的 IM 平台。
  - `operation`：string，当前取值为 `start` 或 `stop`。
  - `result`：string，当前取值为 `success` 或 `failed`。
  - `platformKind`：string，平台形态。当前取值为 `single_instance` 或 `multi_instance`。
  - `enabledInstanceCount`：number，多实例平台当前启用实例数量；单实例平台不发送。
  - `failureReason`：string，失败分类；无法识别时为 `unknown`。仅失败时发送。
- 隐私边界：不上传网关错误详情、账号信息、token、secret、会话 ID 或本地日志内容。

#### 2.4.16 `lobsterai_im_connection_tested`

- 状态：已实现。
- 触发时机：用户在「设置 -> IM 机器人」点击连接测试，并得到测试结果或发生测试异常后发送。
- 事件含义：统计 IM 机器人连接可用性和配置成功率。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_im`。
  - `platform`：string，被测试的 IM 平台。
  - `platformKind`：string，平台形态。当前取值为 `single_instance` 或 `multi_instance`。
  - `result`：string，测试结果。当前取值为 `pass`、`warn`、`fail` 或 `failed`。
  - `checkCount`：number，测试项总数；无法获取时不发送。
  - `failedCheckCount`：number，失败测试项数量；无法获取时不发送。
  - `warningCheckCount`：number，警告测试项数量；无法获取时不发送。
- 隐私边界：不上传测试项 message、网关 URL、账号、会话、群信息、token、secret、请求内容或错误详情。

#### 2.4.17 `lobsterai_im_instance_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> IM 机器人」对多实例平台新增、删除、启用或停用实例，并且操作成功后发送。
- 事件含义：统计多实例 IM 机器人配置规模变化。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_im`。
  - `platform`：string，被操作的 IM 平台。
  - `operation`：string，当前取值为 `added`、`deleted`、`enabled` 或 `disabled`。
  - `instanceCount`：number，操作后的实例数量。
  - `enabledInstanceCount`：number，操作后的启用实例数量。
- 隐私边界：不上传 instanceId、instanceName、账号、邮箱、token、secret、URL 或其它实例配置内容。

#### 2.4.18 `lobsterai_browser_setting_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> 浏览器」修改配置并保存成功后，根据保存前后的 diff 发送。未保存、保存失败或配置无变化不发送。
- 事件含义：统计浏览器访问配置的使用情况，当前只记录网络模式和阻止访问域名列表规模。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_browser`。
  - `changedKeys`：string，本次变化类型的去重列表，使用逗号分隔。当前取值包括 `network_mode`、`blocked_hostnames`。
  - `networkMode`：string，保存后的浏览器网络模式。当前为 `proxy-compatible` 或 `strict`。
  - `blockedHostnameCount`：number，保存后的阻止访问域名数量。
  - `previousBlockedHostnameCount`：number，保存前的阻止访问域名数量；无法获取时不发送。
- 隐私边界：
  - 不上传具体 hostname、URL、CDP URL、浏览器可执行路径、extraArgs、代理地址、测试页面、浏览历史或网页内容。
  - `blockedHostnameCount` 只用于观察配置规模，不表达用户访问或屏蔽了哪些具体站点。

#### 2.4.19 `lobsterai_email_skill_settings_saved`

- 状态：已实现。
- 触发时机：用户在「设置 -> 邮箱」修改 `imap-smtp-email` 技能配置，并且自动保存成功后发送。保存失败或配置无变化不发送。
- 事件含义：统计邮箱技能配置的使用情况和配置完成度，不记录账号、密码或服务器详情。
- 发送口径：
  - 邮箱配置页当前采用 blur 后自动保存；日志只在持久化成功后发送。
  - 同一次自动保存只发送一条摘要事件，不按每个字段逐条发送。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_email`。
  - `skillId`：string，当前固定为 `imap-smtp-email`。
  - `provider`：string，邮箱服务商摘要。当前取值包括 `gmail`、`outlook`、`163`、`126`、`qq`、`custom` 或空字符串。
  - `hasEmail`：boolean，保存后是否填写了邮箱账号。
  - `hasPassword`：boolean，保存后是否填写了密码或授权码。
  - `hasImapHost`：boolean，保存后是否存在 IMAP Host。
  - `hasSmtpHost`：boolean，保存后是否存在 SMTP Host。
  - `imapTlsEnabled`：boolean，保存后是否启用 IMAP TLS。
  - `smtpSslEnabled`：boolean，保存后是否启用 SMTP SSL。
  - `allowInsecureCert`：boolean，保存后是否允许不安全证书。
  - `mailboxCustomized`：boolean，保存后的默认 mailbox 是否不是 `INBOX`。
  - `changedKeys`：string，本次变化类型的去重列表，使用逗号分隔。当前取值包括 `provider`、`email`、`password`、`imap_host`、`imap_port`、`imap_tls`、`smtp_host`、`smtp_port`、`smtp_secure`、`allow_insecure_cert`、`mailbox`。
- 隐私边界：
  - 不上传邮箱地址、密码/授权码、IMAP/SMTP host、端口、mailbox 名称或任何邮件内容。
  - `provider` 只表达预置服务商分类；无法识别时统一为 `custom` 或空字符串。

#### 2.4.20 `lobsterai_email_skill_connection_tested`

- 状态：已实现。
- 触发时机：用户在「设置 -> 邮箱」点击连接测试，并得到测试结果或测试失败后发送。用户未点击测试不发送。
- 事件含义：统计邮箱技能连通性测试的使用情况和通过率。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_email`。
  - `skillId`：string，当前固定为 `imap-smtp-email`。
  - `provider`：string，测试时的邮箱服务商摘要。当前取值包括 `gmail`、`outlook`、`163`、`126`、`qq`、`custom` 或空字符串。
  - `result`：string，测试结果。当前取值为 `pass` 或 `fail`。
  - `imapResult`：string，IMAP 测试项结果。当前取值为 `pass`、`fail` 或空字符串。
  - `smtpResult`：string，SMTP 测试项结果。当前取值为 `pass`、`fail` 或空字符串。
  - `checkCount`：number，测试项数量。
  - `hasEmail`：boolean，测试时是否填写了邮箱账号。
  - `hasPassword`：boolean，测试时是否填写了密码或授权码。
  - `hasImapHost`：boolean，测试时是否存在 IMAP Host。
  - `hasSmtpHost`：boolean，测试时是否存在 SMTP Host。
- 隐私边界：
  - 不上传邮箱地址、密码/授权码、IMAP/SMTP host、端口、测试错误详情、测试项 message 或 AI 诊断 prompt。
  - 失败只通过 `result=fail` 和测试项级别表达，不上传原始异常文本。

#### 2.4.21 `lobsterai_memory_setting_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> 记忆」修改记忆或 Embedding 相关配置，并且设置页保存成功后发送。未保存、保存失败或配置无变化不发送。
- 事件含义：统计记忆功能和 Embedding 语义搜索配置的使用情况。
- 发送口径：
  - 根据保存前后的 `coworkConfig` 做 diff，同一次保存只发送一条摘要事件。
  - 仅记录配置项状态和变化类型，不记录记忆条目内容或远程服务配置详情。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_memory`。
  - `changedKeys`：string，本次变化类型的去重列表，使用逗号分隔。当前取值包括 `memory_enabled`、`llm_judge_enabled`、`embedding_enabled`、`embedding_provider`、`embedding_model`、`embedding_base_url`、`embedding_api_key`、`embedding_vector_weight`。
  - `memoryEnabled`：boolean，保存后是否启用用户记忆。
  - `memoryLlmJudgeEnabled`：boolean，保存后是否启用 LLM 二次判断。
  - `embeddingEnabled`：boolean，保存后是否启用 Embedding 语义搜索。
  - `embeddingProvider`：string，保存后的 Embedding provider。当前取值包括 `openai`、`gemini`、`voyage`、`mistral`、`ollama`。
  - `hasEmbeddingModel`：boolean，保存后是否填写了 Embedding 模型。
  - `hasEmbeddingBaseUrl`：boolean，保存后是否填写了远程 Base URL。
  - `hasEmbeddingApiKey`：boolean，保存后是否填写了远程 API Key。
  - `embeddingVectorWeight`：number，保存后的语义重排权重，范围为 0-1。
- 隐私边界：
  - 不上传记忆条目内容、搜索词、Embedding 模型名称、远程 Base URL、API Key、本地模型路径或文件路径。
  - `embedding_model`、`embedding_base_url` 和 `embedding_api_key` 只表示对应字段发生变化，不上传实际值。

#### 2.4.22 `lobsterai_memory_entry_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> 记忆」手动新增、编辑或删除记忆条目，并且操作成功后发送。操作失败不发送。
- 事件含义：统计用户手动管理记忆条目的使用情况。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_memory`。
  - `operation`：string，条目操作类型。当前取值包括 `created`、`updated`、`deleted`。
  - `entryCount`：number，操作后本地可见记忆条目数量的摘要估算；无法可靠获取时不发送。
- 隐私边界：
  - 不上传记忆条目正文、条目 ID、搜索词、来源信息、创建/更新时间或删除原因。
  - 不记录用户打开编辑弹窗、输入草稿或搜索列表的行为，只记录持久化成功后的 CRUD 操作。

#### 2.4.23 `lobsterai_dreaming_setting_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> 梦境」修改 Dreaming 配置，并且设置页保存成功后发送。未保存、保存失败或配置无变化不发送。
- 事件含义：统计 Dreaming 记忆整理功能的开启和调度配置使用情况。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_dreaming`。
  - `changedKeys`：string，本次变化类型的去重列表，使用逗号分隔。当前取值包括 `dreaming_enabled`、`dreaming_frequency`。
  - `dreamingEnabled`：boolean，保存后是否启用 Dreaming。
  - `frequencyType`：string，保存后的频率类型。当前取值为 `preset` 或 `custom`。
- 隐私边界：不上传自定义 cron 表达式、时区、Dream Diary 内容、记忆内容或模型名称。

#### 2.4.24 `lobsterai_plugin_settings_saved`

- 状态：已实现。
- 触发时机：用户在「设置 -> 插件」修改插件启用状态或插件配置，并且设置页保存成功后发送。未保存、保存失败或无插件变更不发送。
- 事件含义：统计插件设置变更规模，不记录具体插件配置。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_plugins`。
  - `toggleCount`：number，本次保存中发生启用状态变化的插件数量。
  - `enabledToggleCount`：number，本次保存中被启用的插件数量。
  - `disabledToggleCount`：number，本次保存中被停用的插件数量。
  - `configCount`：number，本次保存中发生配置变化的插件数量。
  - `changedKeys`：string，本次变化类型的去重列表，使用逗号分隔。当前取值包括 `toggle`、`config`。
- 隐私边界：不上传插件 ID、插件配置、token、API Key、URL、本地路径、env 或 header。

#### 2.4.25 `lobsterai_plugin_action`

- 状态：已实现。
- 触发时机：用户在「设置 -> 插件」执行安装、卸载、更新、检测本地插件或检查更新等动作，并得到结果后发送。
- 事件含义：统计插件生命周期动作和成功率。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_plugins`。
  - `actionType`：string，动作类型。当前取值包括 `install`、`uninstall`、`update`、`check_updates`、`detect`、`sync`。
  - `result`：string，动作结果。当前取值为 `success` 或 `failed`。
  - `installSource`：string，安装来源；仅安装动作发送。当前取值为 `npm`、`clawhub`、`git`、`local`、`openclaw`。
  - `hasVersion`：boolean，安装时是否填写版本；仅安装动作发送。
  - `hasRegistry`：boolean，安装时是否填写 registry；仅 npm 安装动作发送。
  - `updateCount`：number，检查更新时发现的可更新插件数量；仅检查更新成功时发送。
  - `detectedCount`：number，检测或同步本地插件时发现/同步的插件数量；仅对应动作成功时发送。
- 隐私边界：不上传插件 ID、安装 spec、registry URL、版本号、Git URL、本地路径、安装日志、更新日志或错误详情。

#### 2.4.26 `lobsterai_shortcut_setting_changed`

- 状态：已实现。
- 触发时机：用户在「设置 -> 快捷键」修改快捷键并保存成功后发送。未保存、保存失败或快捷键无变化不发送。
- 事件含义：统计快捷键自定义使用情况。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_shortcuts`。
  - `changedCount`：number，本次保存中发生变化的快捷键数量。
  - `configuredCount`：number，保存后已配置快捷键数量。
  - `disabledCount`：number，保存后被清空的快捷键数量。
  - `resetToDefault`：boolean，保存后的快捷键配置是否与默认配置一致。
- 隐私边界：不上传快捷键具体组合、动作 key、搜索词或冲突提示内容。

#### 2.4.27 `lobsterai_about_action`

- 状态：已实现。
- 触发时机：用户在「设置 -> 关于」执行主动动作后发送。包括检查更新、复制联系邮箱、打开用户社区、打开用户手册、打开服务条款、导出日志。
- 事件含义：统计关于页支持/更新相关入口使用情况。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `settings_about`。
  - `actionType`：string，动作类型。当前取值包括 `check_update`、`copy_contact_email`、`open_user_community`、`open_user_manual`、`open_service_terms`、`export_logs`。
  - `result`：string，动作结果。当前取值为 `success`、`failed`、`canceled`、`update_found`、`up_to_date`、`downloading`、`ready`。
  - `missingEntryCount`：number，导出日志时缺失的日志项数量；仅导出成功且存在缺失项信息时发送。
- 隐私边界：不上传联系邮箱、外链 URL、导出日志路径、日志内容、更新包 URL、错误详情或本地文件信息。

#### 2.4.28 `lobsterai_account_menu_action`

- 状态：已实现。
- 触发时机：用户在首页左下角「我的」入口执行主动动作后发送。包括未登录点击登录、已登录打开/关闭账号菜单、展开/收起剩余额度、打开用量概览、打开充值页、打开邀请页、退出登录。
- 事件含义：统计账号菜单入口的使用情况和常用路径。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `home_account_menu`。
  - `actionType`：string，动作类型。当前取值包括 `login`、`open_menu`、`close_menu`、`expand_credits`、`collapse_credits`、`open_usage_overview`、`open_recharge`、`open_invitation`、`logout`。
  - `result`：string，动作结果。当前取值为 `success` 或 `failed`；仅登录、打开外链和退出登录等异步动作发送。
  - `isLoggedIn`：boolean，触发动作时是否处于登录态。
  - `hasCredits`：boolean，当前账号摘要中是否存在额度明细。
  - `creditItemCount`：number，当前账号摘要中的额度明细数量。
- 隐私边界：
  - 不上传手机号、手机号后四位、昵称、头像 URL、具体剩余额度数值、额度明细 label、额度类型、到期时间、Portal URL、登录 URL 或退出登录错误详情。
  - 额度相关字段只记录是否有额度明细和明细数量，不记录资产金额。

#### 2.4.29 `lobsterai_sidebar_action`

- 状态：已实现。
- 触发时机：用户在首页左侧边栏执行主动动作后发送。包括顶部导航入口、折叠/展开侧边栏、Agent 行操作、历史任务列表点击、任务菜单、展开更多/收起、批量操作和子任务操作。
- 事件含义：统计首页侧边栏主要入口、Agent/任务列表和批量操作的使用情况。
- 业务参数：
  - `source`：string，触发来源。当前取值包括 `home_sidebar`、`home_agent_sidebar`。
  - `actionType`：string，动作类型。当前取值包括：
    - 顶部入口：`new_task`、`open_search`、`open_scheduled_tasks`、`open_kits`、`open_skills`、`open_mcp`、`collapse_sidebar`、`expand_sidebar`。
    - Agent 行：`agent_header_click`、`agent_create_task`、`agent_menu_open`、`agent_edit`、`agent_pin_toggle`、`agent_delete_confirm_open`、`agent_delete_cancel`、`agent_delete_submit`、`agent_delete_success`、`agent_delete_failed`。
    - 历史任务：`select_task`、`task_menu_open`、`task_pin_toggle`、`task_rename_start`、`task_rename_cancel`、`task_rename_submit`、`task_share_open`、`task_delete_confirm_open`、`task_delete_cancel`、`task_delete_submit`、`task_delete_success`、`task_delete_failed`。
    - 列表加载：`task_list_expand_more`、`task_list_collapse`、`task_list_retry_load`。
    - 批量操作：`batch_mode_enter`、`batch_mode_exit`、`batch_item_toggle`、`batch_select_all_toggle`、`batch_delete_confirm_open`、`batch_delete_cancel`、`batch_delete_submit`、`batch_delete_success`、`batch_delete_failed`。
    - 子任务：`select_subagent_task`、`subagent_delete_confirm_open`、`subagent_delete_cancel`、`subagent_delete_submit`、`subagent_delete_success`、`subagent_delete_failed`。
  - `activeView`：string，触发时当前主视图。当前取值包括 `cowork`、`skills`、`scheduledTasks`、`kits`、`mcp`。
  - `isCollapsed`：boolean，触发时侧边栏是否折叠；仅顶部侧边栏入口发送。
  - `agentType`：string，相关 Agent 类型。当前取值为 `main` 或 `custom`。
  - `isPinned`：boolean，相关 Agent 或任务触发前是否已置顶；仅置顶、菜单和相关行操作按需发送。
  - `targetPinned`：boolean，置顶切换后的目标状态；仅置顶切换时发送。
  - `isExpanded`：boolean，Agent 行触发前是否处于展开状态；仅 Agent 行点击/菜单按需发送。
  - `visibleTaskCount`：number，当前 Agent 可见任务数量；仅展开更多、收起和加载重试时发送。
  - `isCurrentSession`：boolean，被选择或操作的任务是否为当前会话；仅任务相关操作按需发送。
  - `taskStatus`：string，被选择或操作任务的状态摘要；仅任务相关操作按需发送。
  - `hasActiveSubagent`：boolean，当前任务是否有正在查看的子任务；仅任务行操作按需发送。
  - `subagentStatus`：string，被选择或操作子任务的状态摘要；仅子任务相关操作发送。
  - `isCurrentSubagent`：boolean，被选择或操作子任务是否为当前子任务；仅子任务相关操作发送。
  - `selectedCount`：number，批量模式当前选中项目数；仅批量操作发送。
  - `selectableCount`：number，批量模式当前可选项目数；仅批量操作发送。
  - `selectedSessionCount`：number，批量模式当前选中的主任务数量；仅批量删除提交/结果发送。
  - `selectedSubagentCount`：number，批量模式当前选中的子任务数量；仅批量删除提交/结果发送。
  - `targetSelected`：boolean，批量单项切换后的目标选中状态；仅 `batch_item_toggle` 发送。
  - `isSelectAllChecked`：boolean，全选切换后的目标状态；仅 `batch_select_all_toggle` 发送。
  - `result`：string，异步操作结果。当前取值为 `success` 或 `failed`；仅删除、置顶、重命名等完成后按需发送。
- 隐私边界：
  - 不上传任务标题、sessionId、subagentId、runId、agentId、agentName、消息内容、创建/更新时间、用户输入或本地路径。
  - 重命名只记录开始、取消和提交结果，不上传新旧标题。
  - 批量操作只记录数量和类型，不上传具体条目 ID。

#### 2.4.30 `lobsterai_task_search_action`

- 状态：已实现。
- 触发时机：用户打开/关闭首页任务搜索弹窗、搜索结果为空、或点击搜索结果任务后发送。
- 事件含义：统计任务搜索入口使用情况和搜索结果点击情况。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `home_task_search`。
  - `actionType`：string，动作类型。当前取值包括 `open`、`close`、`empty_result`、`select_result`。
  - `hasQuery`：boolean，触发时搜索框是否有输入。
  - `resultCount`：number，触发时展示的结果数量。
  - `isCurrentSession`：boolean，被点击结果是否为当前会话；仅 `select_result` 时发送。
  - `sessionStatus`：string，被点击结果的状态摘要；仅 `select_result` 时发送。
  - `agentType`：string，被点击结果所属 Agent 类型。当前取值为 `main` 或 `custom`；仅 `select_result` 时发送。
- 隐私边界：
  - 不上传搜索词、任务标题、sessionId、agentId、agentName、消息内容、创建/更新时间或本地路径。
  - 不记录每次输入变化，避免产生高频噪音和隐私风险。

#### 2.4.31 `lobsterai_agent_settings_action`

- 状态：已实现。
- 触发时机：用户打开 Agent 编辑弹窗、切换弹窗 tab、保存配置、关闭弹窗或处理未保存变更确认时发送。
- 事件含义：统计 Agent 编辑弹窗内的主要配置行为，补齐侧边栏 `agent_edit` 之后的弹窗内操作路径。
- 业务参数：
  - `source`：string，触发来源。当前固定为 `agent_settings_panel`。
  - `actionType`：string，动作类型。当前取值包括 `open`、`close`、`tab_change`、`save_submit`、`save_success`、`save_failed`、`discard_confirm_open`、`discard_confirm_submit`、`discard_confirm_cancel`。
  - `agentType`：string，相关 Agent 类型。当前取值为 `main` 或 `custom`。
  - `activeTab`：string，触发时当前 tab。当前取值包括 `identity`、`prompt`、`user`、`skills`、`im`。
  - `targetTab`：string，目标 tab；仅 `tab_change` 时发送。
  - `isDirty`：boolean，触发时弹窗内容是否存在未保存变更。
  - `changedFieldCount`：number，触发时发生变更的字段数量；仅保存和未保存确认相关动作发送。
  - `changedFields`：string，触发时发生变更的字段 key 列表，以英文逗号连接；当前可能包含 `name`、`description`、`systemPrompt`、`identity`、`userInfo`、`icon`、`model`、`workingDirectory`、`skillIds`、`imBindings`。
  - `skillCount`：number，当前 Agent 已选择技能数量。
  - `imBindingCount`：number，当前 Agent 显式绑定 IM 渠道数量。
  - `hasModel`：boolean，当前是否选择模型。
  - `hasWorkingDirectory`：boolean，当前是否设置工作目录。
  - `result`：string，保存结果。当前取值为 `success` 或 `failed`；仅保存完成后发送。
  - `modelId`：string，当前选择模型 ID；仅保存相关动作发送。
  - `modelName`：string，当前选择模型展示名称；仅保存相关动作发送。
  - `modelSource`：string，模型来源分类。当前取值为 `package` 或 `custom`；仅保存相关动作发送。
  - `providerKey`：string，当前模型所属 provider key；仅保存相关动作发送。
  - `provider`：string，当前模型所属 provider 展示名称；仅保存相关动作发送。
  - `selectorGroup`：string，当前模型选择器分组，取值为 `server` 或 `user`；仅保存相关动作发送。
  - `skillIds`：string，当前选择技能 ID 列表，以英文逗号连接；仅保存相关动作发送。
  - `skillNames`：string，当前选择技能展示名称列表，以英文逗号连接；仅保存相关动作发送。
  - `builtInSkillCount`：number，当前选择技能中的内置技能数量；仅保存相关动作发送。
  - `customSkillCount`：number，当前选择技能中的非内置技能数量；仅保存相关动作发送。
  - `imPlatforms`：string，当前显式绑定 IM 平台列表，以英文逗号连接；仅保存相关动作发送。
- 隐私边界：
  - 不上传 Agent 名称、简介、头像值、system prompt、identity、userInfo、工作目录路径、IM 渠道 key 或错误详情。
  - 保存相关动作会上传模型 ID/名称、技能 ID/名称和 IM 平台名，用于分析 Agent 配置行为。
  - 文本编辑只记录字段是否发生变更，不记录内容长度或文本内容。
  - 关闭和切换 tab 只记录行为摘要，避免对每次输入做高频上报。

#### 2.4.32 `lobsterai_agent_create_action`

- 状态：已实现。
- 触发时机：用户打开创建 Agent 弹窗、打开/关闭模板选择、选择模板、切换弹窗 tab、创建 Agent、关闭弹窗或处理未保存变更确认时发送。
- 事件含义：统计 Agent 创建入口、模板使用、创建配置选择和创建结果。
- 业务参数：
  - `source`：string，触发来源。当前取值包括 `home_agent_sidebar`、`home_agent_sidebar_empty`、`agents_view`、`agent_create_modal`。
  - `actionType`：string，动作类型。当前取值包括 `open`、`close`、`open_template_picker`、`close_template_picker`、`template_selected`、`tab_change`、`create_submit`、`create_success`、`create_failed`、`discard_confirm_open`、`discard_confirm_submit`、`discard_confirm_cancel`。
  - `activeTab`：string，触发时当前 tab。当前取值包括 `identity`、`prompt`、`user`、`skills`、`im`。
  - `targetTab`：string，目标 tab；仅 `tab_change` 时发送。
  - `creationMode`：string，创建方式。当前取值为 `blank` 或 `template`。
  - `isDirty`：boolean，触发时弹窗内容是否存在未保存变更。
  - `changedFieldCount`：number，触发时发生变更的字段数量；仅创建和未保存确认相关动作发送。
  - `changedFields`：string，触发时发生变更的字段 key 列表，以英文逗号连接；当前可能包含 `name`、`description`、`systemPrompt`、`identity`、`userInfo`、`icon`、`model`、`workingDirectory`、`skillIds`、`imBindings`。
  - `templateId`：string，被选择模板 ID；仅模板选择和模板创建相关动作发送。
  - `templateName`：string，被选择模板展示名称；仅模板选择和模板创建相关动作发送。
  - `templateSkillCount`：number，被选择模板包含的技能数量；仅模板选择和模板创建相关动作发送。
  - `skillCount`：number，当前选择技能数量。
  - `imBindingCount`：number，当前显式绑定 IM 渠道数量。
  - `hasModel`：boolean，当前是否选择模型。
  - `hasWorkingDirectory`：boolean，当前是否设置工作目录。
  - `result`：string，创建结果。当前取值为 `success` 或 `failed`；仅创建完成后发送。
  - `errorCode`：string，失败分类。当前取值包括 `user_info_write_failed`、`create_agent_failed`、`unknown`；仅创建失败时发送。
  - `modelId`：string，当前选择模型 ID；仅创建相关动作发送。
  - `modelName`：string，当前选择模型展示名称；仅创建相关动作发送。
  - `modelSource`：string，模型来源分类。当前取值为 `package` 或 `custom`；仅创建相关动作发送。
  - `providerKey`：string，当前模型所属 provider key；仅创建相关动作发送。
  - `provider`：string，当前模型所属 provider 展示名称；仅创建相关动作发送。
  - `selectorGroup`：string，当前模型选择器分组，取值为 `server` 或 `user`；仅创建相关动作发送。
  - `skillIds`：string，当前选择技能 ID 列表，以英文逗号连接；仅创建相关动作发送。
  - `skillNames`：string，当前选择技能展示名称列表，以英文逗号连接；仅创建相关动作发送。
  - `builtInSkillCount`：number，当前选择技能中的内置技能数量；仅创建相关动作发送。
  - `customSkillCount`：number，当前选择技能中的非内置技能数量；仅创建相关动作发送。
  - `imPlatforms`：string，当前显式绑定 IM 平台列表，以英文逗号连接；仅创建相关动作发送。
- 隐私边界：
  - 不上传 Agent 名称、简介、头像值、system prompt、identity、userInfo、工作目录路径、IM 渠道 key、创建后的 agentId 或错误详情。
  - 创建相关动作会上传模型 ID/名称、技能 ID/名称、模板 ID/名称和 IM 平台名，用于分析 Agent 创建行为。
  - 文本编辑只记录字段是否发生变更，不记录内容长度或文本内容。
  - 关闭和切换 tab 只记录行为摘要，避免对每次输入做高频上报。

### 2.5 请求流程

```text
业务模块
  -> reportYdAnalyzer(params)
  -> 校验 action
  -> buildLogUrl(params)
  -> 自动补充通用参数、安装 ID、渠道归因、用户 ID、时间戳和基础环境参数
  -> window.electron.api.fetch(GET)
  -> 返回 true 或 false
```

请求复用现有的 Electron API 网络桥接，由主进程通过 Electron session 发出请求，以避免 Renderer 的 CORS 限制。

`uuid` 复用已有 `installation_uuid`，不新增数据库表或迁移脚本。`firstKeyfrom` 和 `latestKeyfrom` 复用主进程现有渠道归因服务，并通过只读 IPC 暴露给 Renderer 日志模块。上述参数读取失败时不会阻断日志请求，只会省略对应字段。

日志请求失败时只记录警告并返回 `false`，不会向调用方抛出异常，也不会阻断原业务流程。

Renderer 调试日志只记录事件 `action` 和请求结果，不记录完整请求地址或事件参数。主进程的通用 API 请求日志会移除 URL query 和 fragment 后再写入本地日志，避免 `log_Usid` 和事件参数进入本地日志文件。

### 2.6 设置开关

使用统计开关放在：

```text
设置 -> 通用 -> 帮助改进 LobsterAI
```

配置字段为 `usageAnalyticsEnabled`，存储在现有 `app_config` 中，默认值为 `true`。老用户本地配置中没有该字段时，按开启处理，不需要新增数据库表或迁移脚本。

用户关闭后，`reportYdAnalyzer()` 在发送请求前直接跳过并返回 `false`，不会访问日志服务。该跳过行为只写入一条 Renderer debug 日志，不影响业务流程。

用户可见文案应避免使用“日志上报”，避免误解为上传本地日志文件。当前中文文案为：

- 标题：`帮助改进 LobsterAI`
- 描述：`允许发送基础使用统计，帮助我们改进功能体验。不会上传对话内容、文件内容或 API Key。`

### 2.7 当前调用方式

计划模式开启事件当前按以下方式调用：

```typescript
void reportYdAnalyzer({
  action: LogReporterAction.PlanModeEnabled,
  entry: LogReporterEntry.PromptToolsMenu,
});
```

`action` 为 `lobsterai_plan_mode_enabled`，`entry` 为 `prompt_tools_menu`。调用使用 fire-and-forget 方式，不等待网络请求，不阻塞计划模式状态切换或界面交互。

## 3. 后续待完善内容

后续讨论和实现至少需要补充：

1. 定义下一批事件名称、触发时机和允许上报的参数。
2. 定义安装、技能、MCP、专家套件、模型和其他功能的统计口径。
3. 确定自定义技能和自定义 MCP 信息的上报边界。
4. 继续评估是否需要补充分发渠道之外的其他通用环境参数。
5. 评估是否需要去重、采样、批量发送和失败重试。
6. 补充隐私说明、数据保留周期和日志调试方式。
7. 补充真实应用内的手动验收记录，包括开启计划模式、关闭使用统计开关和请求参数检查。
