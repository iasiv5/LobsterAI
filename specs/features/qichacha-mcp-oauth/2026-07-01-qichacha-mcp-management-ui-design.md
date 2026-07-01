# 企查查 MCP 管理 UI 设计文档

## 1. 概述

企查查 MCP 安装后会创建 6 个独立 HTTP MCP server。运行层需要保留这 6 条记录，但在 MCP 管理界面逐条展示会让用户误以为安装了 6 个独立产品，并且市场卡片缺少统一卸载入口。

本次改动仅调整管理 UI 和批量操作能力，继续保留现有 API key 授权方案，不修改 `src/main/mcp/qichachaMcpAuth.ts`。

## 2. 用户场景

### 场景 1：查看已安装的企查查 MCP

**Given** 用户已安装企查查 MCP  
**When** 用户进入 MCP 的“已安装”页  
**Then** 页面只显示一张“企查查”聚合卡片，并标明该入口包含 6 个 MCP 服务。

### 场景 2：统一启停

**Given** 用户已安装企查查 MCP  
**When** 用户切换聚合卡片的启停开关  
**Then** 所有 `registryId=qichacha` 的 MCP server 一次性启用或停用，并只触发一次 OpenClaw 配置同步。

### 场景 3：统一卸载

**Given** 用户已安装企查查 MCP  
**When** 用户在市场卡片或已安装聚合卡片点击“卸载”并确认  
**Then** 删除所有 `registryId=qichacha` 的 MCP server，并只触发一次 OpenClaw 配置同步。

## 3. 实现方案

### 3.1 数据与运行层

- SQLite 中继续保存 6 条独立 `mcp_servers` 记录。
- OpenClaw 配置同步继续输出 6 个独立 MCP server。
- 不增加 bundle 表，不修改企查查 server URL、Authorization header 或 API key 获取流程。

### 3.2 批量 IPC

新增两个通用批量 IPC：

- `mcp:deleteByRegistryId`
- `mcp:setEnabledByRegistryId`

主进程按 `registryId` 筛选现有记录，批量完成操作后统一读取 server 列表并触发一次配置同步。

### 3.3 已安装页面

- Renderer 将 `registryId=qichacha` 的记录转换成一个仅用于展示的聚合 item。
- 聚合卡片显示企查查名称、市场描述、HTTP 类型、实际 server 数量和统一 URL 摘要。
- 聚合卡片不提供单条编辑入口，只提供统一卸载和统一启停。
- 已安装数量按聚合后的展示 item 数量计算。

### 3.4 市场页面

- 未安装时显示“登录授权”。
- 已安装时仅显示“卸载”，不显示“重新授权”。
- 卸载进入统一确认流程，调用 `deleteByRegistryId`。

## 4. 边界情况

| 场景 | 处理方式 |
| --- | --- |
| 企查查只剩部分 server | 仍聚合展示，并显示实际 server 数量 |
| 部分 server 已启用 | 聚合开关显示为启用；点击后统一停用全部 server |
| registryId 下没有记录 | 批量删除/启停返回成功，保持幂等 |
| 其他市场 MCP | 保持现有单 server 展示和操作逻辑 |

## 5. 涉及文件

- `src/shared/mcp/constants.ts`
- `src/main/ipcHandlers/mcp/handlers.ts`
- `src/main/preload.ts`
- `src/renderer/types/electron.d.ts`
- `src/renderer/services/mcp.ts`
- `src/renderer/components/mcp/McpManager.tsx`
- `src/renderer/services/i18n.ts`

## 6. 验收标准

- 已安装页只显示一张企查查卡片，并显示 6 个服务。
- 已安装数量不再将企查查计为 6 个独立项目。
- 聚合开关一次性启停全部企查查 server。
- 市场中已安装的企查查只显示“卸载”。
- 卸载确认后删除全部 `registryId=qichacha` 记录。
- 企查查 API key 授权代码和 OpenClaw 的 6 server 运行配置保持不变。
