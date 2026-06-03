export const McpIpcChannel = {
  List: 'mcp:list',
  Create: 'mcp:create',
  Update: 'mcp:update',
  Delete: 'mcp:delete',
  SetEnabled: 'mcp:setEnabled',
  RetryLaunchResolution: 'mcp:retryLaunchResolution',
  FetchMarketplace: 'mcp:fetchMarketplace',
  Changed: 'mcp:changed',
} as const;
export type McpIpcChannel = typeof McpIpcChannel[keyof typeof McpIpcChannel];
