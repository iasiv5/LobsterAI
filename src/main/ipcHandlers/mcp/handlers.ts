import { app, ipcMain } from 'electron';
import https from 'https';

import { McpIpcChannel } from '../../../shared/mcp/constants';
import type { McpRuntime } from '../../mcp/mcpRuntime';
import type { McpServerFormData } from '../../mcp/mcpStore';

export interface McpHandlerDeps {
  getMcpRuntime: () => McpRuntime;
  syncOpenClawConfig: (options: {
    reason: string;
    restartGatewayIfRunning?: boolean;
  }) => Promise<{ success: boolean; changed: boolean }>;
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function syncMcpConfig(
  syncOpenClawConfig: McpHandlerDeps['syncOpenClawConfig'],
  reason: string,
): void {
  syncOpenClawConfig({ reason }).catch(err =>
    console.error('[MCP] config sync error:', err),
  );
}

export function registerMcpHandlers(deps: McpHandlerDeps): void {
  const { getMcpRuntime, syncOpenClawConfig } = deps;

  ipcMain.handle(McpIpcChannel.List, () => {
    try {
      const servers = getMcpRuntime().getStore().listServers();
      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list MCP servers',
      };
    }
  });

  ipcMain.handle(
    McpIpcChannel.Create,
    async (
      _event,
      data: {
        name: string;
        description: string;
        transportType: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
      },
    ) => {
      try {
        const mcpRuntime = getMcpRuntime();
        const server = mcpRuntime.getStore().createServer(data as McpServerFormData);
        if (server.enabled) {
          mcpRuntime.ensureLaunchResolution(server.id, 'mcp-server-created');
        }
        const servers = mcpRuntime.getStore().listServers();
        syncMcpConfig(syncOpenClawConfig, 'mcp-server-created');
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create MCP server',
        };
      }
    },
  );

  ipcMain.handle(
    McpIpcChannel.Update,
    async (
      _event,
      id: string,
      data: {
        name?: string;
        description?: string;
        transportType?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
      },
    ) => {
      try {
        const mcpRuntime = getMcpRuntime();
        const server = mcpRuntime.getStore().updateServer(id, data as Partial<McpServerFormData>);
        if (server?.enabled) {
          mcpRuntime.ensureLaunchResolution(server.id, 'mcp-server-updated');
        }
        const servers = mcpRuntime.getStore().listServers();
        syncMcpConfig(syncOpenClawConfig, 'mcp-server-updated');
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update MCP server',
        };
      }
    },
  );

  ipcMain.handle(McpIpcChannel.Delete, async (_event, id: string) => {
    try {
      const mcpRuntime = getMcpRuntime();
      mcpRuntime.getStore().deleteServer(id);
      const servers = mcpRuntime.getStore().listServers();
      syncMcpConfig(syncOpenClawConfig, 'mcp-server-deleted');
      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete MCP server',
      };
    }
  });

  ipcMain.handle(McpIpcChannel.SetEnabled, async (_event, options: { id: string; enabled: boolean }) => {
    try {
      const mcpRuntime = getMcpRuntime();
      mcpRuntime.getStore().setEnabled(options.id, options.enabled);
      if (options.enabled) {
        mcpRuntime.ensureLaunchResolution(options.id, 'mcp-server-enabled');
      }
      const servers = mcpRuntime.getStore().listServers();
      syncMcpConfig(syncOpenClawConfig, 'mcp-server-toggled');
      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update MCP server',
      };
    }
  });

  ipcMain.handle(McpIpcChannel.RetryLaunchResolution, async (_event, id: string) => {
    try {
      const mcpRuntime = getMcpRuntime();
      await mcpRuntime.getLaunchResolverManager().retry(id);
      const servers = mcpRuntime.getStore().listServers();
      syncMcpConfig(syncOpenClawConfig, 'mcp-launch-manual-retry');
      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retry MCP launch resolution',
      };
    }
  });

  ipcMain.handle(McpIpcChannel.FetchMarketplace, async () => {
    const url = app.isPackaged
      ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/mcp-marketplace'
      : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/test/mcp-marketplace';
    try {
      const data = await fetchText(url);
      const json = JSON.parse(data);
      const value = json?.data?.value;
      if (!value) {
        return { success: false, error: 'Invalid response: missing data.value' };
      }
      const marketplace = typeof value === 'string' ? JSON.parse(value) : value;
      return { success: true, data: marketplace };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch marketplace',
      };
    }
  });
}
