import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import path from 'path';

import { McpIpcChannel } from '../../shared/mcp/constants';
import { getElectronNodeRuntimePath } from '../libs/coworkUtil';
import {
  type AskUserRequest,
  type AskUserResponse,
  McpBridgeServer,
  type MediaGenerationRequest,
  type MediaGenerationResponse,
} from '../libs/mcpBridgeServer';
import type { ResolvedMcpServer } from '../libs/openclawConfigSync';
import { resolveStdioCommand } from '../libs/resolveStdioCommand';
import type { SqliteStore } from '../sqliteStore';
import { createMcpLaunchSourceFingerprint, McpLaunchResolutionStatus } from './mcpLaunchResolution';
import { McpLaunchResolverManager } from './mcpLaunchResolverManager';
import { McpStore } from './mcpStore';

export type { AskUserResponse, MediaGenerationRequest, MediaGenerationResponse };

export interface McpRuntimeDeps {
  getStore: () => SqliteStore;
  syncOpenClawConfig: (options: {
    reason: string;
    restartGatewayIfRunning?: boolean;
  }) => Promise<{ success: boolean; changed: boolean }>;
}

export class McpRuntime {
  private mcpStore: McpStore | null = null;
  private launchResolverManager: McpLaunchResolverManager | null = null;
  private bridgeServer: McpBridgeServer | null = null;
  private readonly bridgeSecret = crypto.randomUUID();
  private resolvedServersCache: ResolvedMcpServer[] = [];
  private mediaGenerationHandler:
    | ((request: MediaGenerationRequest) => Promise<MediaGenerationResponse>)
    | null = null;

  constructor(private readonly deps: McpRuntimeDeps) {}

  getStore(): McpStore {
    if (!this.mcpStore) {
      const sqliteStore = this.deps.getStore();
      this.mcpStore = new McpStore(sqliteStore.getDatabase());
    }
    return this.mcpStore;
  }

  getLaunchResolverManager(): McpLaunchResolverManager {
    if (!this.launchResolverManager) {
      this.launchResolverManager = new McpLaunchResolverManager(
        this.getStore(),
        () => this.broadcastServersChanged(),
        reason => {
          this.deps.syncOpenClawConfig({ reason }).catch(err =>
            console.error('[MCP] config sync error after launch resolution:', err),
          );
        },
      );
    }
    return this.launchResolverManager;
  }

  ensureLaunchResolution(serverId: string, reason: string): void {
    this.getLaunchResolverManager().ensureResolved(serverId, reason);
  }

  setMediaGenerationHandler(
    handler: (request: MediaGenerationRequest) => Promise<MediaGenerationResponse>,
  ): void {
    this.mediaGenerationHandler = handler;
  }

  getAskUserCallbackUrl(): string | null {
    return this.bridgeServer?.askUserCallbackUrl ?? null;
  }

  getMediaCallbackUrl(): string | null {
    return this.bridgeServer?.mediaCallbackUrl ?? null;
  }

  getBridgeSecret(): string {
    return this.bridgeSecret;
  }

  getResolvedServersCache(): ResolvedMcpServer[] {
    return this.resolvedServersCache;
  }

  async refreshResolvedServersCache(): Promise<ResolvedMcpServer[]> {
    this.resolvedServersCache = await this.getResolvedServers();
    return this.resolvedServersCache;
  }

  clearResolvedServersCache(): void {
    this.resolvedServersCache = [];
  }

  async startAskUserServer(): Promise<void> {
    if (this.bridgeServer?.port) return;

    if (!this.bridgeServer) {
      this.bridgeServer = new McpBridgeServer(this.bridgeSecret);
    }
    console.log('[AskUser] starting HTTP callback server...');
    await this.bridgeServer.start();

    this.bridgeServer.onAskUser(request => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win.isDestroyed()) return;
        try {
          win.webContents.send('cowork:stream:permission', {
            sessionId: '__askuser__',
            request: {
              requestId: request.requestId,
              toolName: 'AskUserQuestion',
              toolInput: { questions: request.questions },
            },
          });
        } catch (error) {
          console.error('[AskUser] failed to send permission request to window:', error);
        }
      });
    });

    this.bridgeServer.onAskUserDismiss(requestId => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win.isDestroyed()) return;
        try {
          win.webContents.send('cowork:stream:permissionDismiss', { requestId });
        } catch {
          // ignore
        }
      });
    });

    this.bridgeServer.onMediaGeneration(async (request) => {
      if (!this.mediaGenerationHandler) {
        return {
          content: [{ type: 'text', text: 'Media generation service is not ready yet.' }],
          isError: true,
        };
      }
      return await this.mediaGenerationHandler(request);
    });
  }

  async askUserInternal(
    questions: AskUserRequest['questions'],
    timeoutMs?: number,
  ): Promise<AskUserResponse | null> {
    if (!this.bridgeServer) return null;
    return await this.bridgeServer.askUserInternal(questions, timeoutMs);
  }

  resolveAskUser(requestId: string, response: AskUserResponse): void {
    this.bridgeServer?.resolveAskUser(requestId, response);
  }

  broadcastServersChanged(): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(McpIpcChannel.Changed);
      } catch {
        // ignore destroyed windows
      }
    });
  }

  private async getResolvedServers(): Promise<ResolvedMcpServer[]> {
    const startedAt = Date.now();
    const enabledServers = this.getStore().getEnabledServers();
    const resolved: ResolvedMcpServer[] = [];
    let optimizedCount = 0;
    let skippedCount = 0;
    let rawCount = 0;

    const electronPath = getElectronNodeRuntimePath();
    const npmBinDir = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin')
      : '';

    for (const server of enabledServers) {
      if (server.transportType === 'stdio') {
        const launchResolver = this.getLaunchResolverManager();
        if (launchResolver.canOptimize(server)) {
          const readyResolution = launchResolver.getReadyResolution(server);
          if (readyResolution) {
            optimizedCount++;
            const shimEnv: Record<string, string> = {
              LOBSTERAI_ELECTRON_PATH: electronPath,
            };
            if (npmBinDir) {
              shimEnv.LOBSTERAI_NPM_BIN_DIR = npmBinDir;
            }
            resolved.push({
              name: server.name,
              transportType: 'stdio',
              command: readyResolution.command,
              args: readyResolution.args || [],
              env: { ...shimEnv, ...(readyResolution.env || {}), ...(server.env || {}) },
            });
            continue;
          }

          const fingerprint = createMcpLaunchSourceFingerprint(server);
          const status = server.launchResolution?.sourceFingerprint === fingerprint
            ? server.launchResolution.status
            : McpLaunchResolutionStatus.Pending;
          if (status === McpLaunchResolutionStatus.Unsupported) {
            rawCount++;
            const r = await resolveStdioCommand(server);
            const shimEnv: Record<string, string> = {
              LOBSTERAI_ELECTRON_PATH: electronPath,
            };
            if (npmBinDir) {
              shimEnv.LOBSTERAI_NPM_BIN_DIR = npmBinDir;
            }
            resolved.push({
              name: server.name,
              transportType: 'stdio',
              command: r.command,
              args: r.args,
              env: { ...shimEnv, ...(r.env || {}) },
            });
            continue;
          }

          skippedCount++;
          console.log(
            `[MCP] skipping stdio server "${server.name}" while managed launch resolution is ${status}`,
          );
          if (launchResolver.shouldStartResolution(server, status)) {
            this.ensureLaunchResolution(server.id, `config-sync:${status}`);
          }
          continue;
        }

        rawCount++;
        const r = await resolveStdioCommand(server);
        const shimEnv: Record<string, string> = {
          LOBSTERAI_ELECTRON_PATH: electronPath,
        };
        if (npmBinDir) {
          shimEnv.LOBSTERAI_NPM_BIN_DIR = npmBinDir;
        }
        resolved.push({
          name: server.name,
          transportType: 'stdio',
          command: r.command,
          args: r.args,
          env: { ...shimEnv, ...(r.env || {}) },
        });
      } else {
        resolved.push({
          name: server.name,
          transportType: server.transportType,
          url: server.url,
          headers: server.headers,
        });
      }
    }
    console.log(
      `[MCP] resolved ${resolved.length}/${enabledServers.length} enabled server(s) for OpenClaw in ${Date.now() - startedAt}ms; optimized=${optimizedCount}, raw=${rawCount}, skipped=${skippedCount}`,
    );
    return resolved;
  }
}
