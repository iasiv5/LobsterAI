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
