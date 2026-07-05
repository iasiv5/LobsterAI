import { ipcMain } from 'electron';

import {
  DeliveryMode as STDeliveryMode,
  IpcChannel as ScheduledTaskIpc,
  PayloadKind as STPayloadKind,
  SessionTarget as STSessionTarget,
} from '../../../scheduledTask/constants';
import type { CronJobService } from '../../../scheduledTask/cronJobService';
import { OpenClawEnginePhase } from '../../../shared/openclawEngine/constants';
import {
  imConversationDisplayName,
  parseImConversationId,
  PlatformRegistry,
} from '../../../shared/platform';
import { listScheduledTaskChannels } from './helpers';

/** Matches auto-generated channel session titles, e.g. "[TG] group:123". */
const AUTO_CHANNEL_TITLE_RE = /^\[[^\]]*\]\s/;

export interface ScheduledTaskHandlerDeps {
  getCronJobService: () => CronJobService;
  getIMGatewayManager: () => {
    getIMStore: () =>
      | {
          getSessionMapping: (
            conversationId: string,
            platform: string,
          ) =>
            | {
                coworkSessionId: string;
              }
            | undefined;
          listSessionMappings: (
            platform: string,
            agentId?: string,
          ) => Array<{
            imConversationId: string;
            platform: string;
            coworkSessionId: string;
            agentId: string;
            lastActiveAt: string;
          }>;
        }
      | undefined;
    primeConversationReplyRoute: (
      platform: string,
      conversationId: string,
      coworkSessionId: string,
    ) => Promise<void>;
  } | null;
  /** Resolve a Cowork session title for conversation display names. */
  getCoworkSessionTitle: (sessionId: string) => string | null;
  getOpenClawRuntimeAdapter: () => {
    getGatewayClient: () => unknown;
    getEngineStatusSnapshot: () => { phase: OpenClawEnginePhase };
    connectGatewayIfNeeded: () => Promise<void>;
    fetchSessionByKey: (
      sessionKey: string,
      options?: { sessionId?: string | null },
    ) => Promise<unknown>;
  } | null;
}

/**
 * Normalizes an announce-mode delivery payload for OpenClaw native delivery.
 * Mutates `normalizedInput` in place: sets sessionTarget, converts SystemEvent
 * payloads to AgentTurn, strips IM subtype prefixes from delivery.to, and primes
 * the DingTalk reply route when needed.
 */
async function applyAnnounceDeliveryNormalization(
  normalizedInput: Record<string, any>,
  getIMGatewayManager: ScheduledTaskHandlerDeps['getIMGatewayManager'],
): Promise<void> {
  const delivery = normalizedInput.delivery;
  if (!(delivery && delivery.mode === STDeliveryMode.Announce && delivery.channel && delivery.to)) {
    return;
  }
  const platform = PlatformRegistry.platformOfChannel(delivery.channel);
  if (!platform) return;

  normalizedInput.sessionTarget = STSessionTarget.Isolated;
  if (normalizedInput.payload?.kind === STPayloadKind.SystemEvent) {
    normalizedInput.payload = {
      kind: STPayloadKind.AgentTurn,
      message: normalizedInput.payload.text || '',
    };
  }

  // Strip IM subtype prefix (e.g. "direct:ou_xxx" -> "ou_xxx").
  // Use lastIndexOf to handle IDs that contain colons themselves.
  const rawTo = delivery.to;
  const colonIdx = rawTo.lastIndexOf(':');
  if (colonIdx > 0) {
    delivery.to = rawTo.slice(colonIdx + 1);
    console.debug(
      '[ScheduledTask] stripped IM subtype prefix from delivery.to:',
      rawTo,
      '->',
      delivery.to,
    );
  }

  if (platform === 'dingtalk') {
    const imStore = getIMGatewayManager()?.getIMStore();
    const mapping = imStore?.getSessionMapping(rawTo, platform);
    if (mapping) {
      await getIMGatewayManager()!.primeConversationReplyRoute(
        platform,
        rawTo,
        mapping.coworkSessionId,
      );
    }
  }
}

async function ensureScheduledTaskGatewayClient(
  getOpenClawRuntimeAdapter: ScheduledTaskHandlerDeps['getOpenClawRuntimeAdapter'],
): Promise<boolean> {
  const adapter = getOpenClawRuntimeAdapter();
  if (!adapter) return false;
  if (adapter.getGatewayClient()) return true;

  // While the engine is still installing/starting, report not-ready instead
  // of blocking on gateway startup; the renderer reloads via the refresh
  // event after the first successful cron poll.
  if (adapter.getEngineStatusSnapshot().phase !== OpenClawEnginePhase.Running) {
    return false;
  }

  await adapter.connectGatewayIfNeeded();
  return Boolean(adapter.getGatewayClient());
}

export function registerScheduledTaskHandlers(deps: ScheduledTaskHandlerDeps): void {
  const { getCronJobService, getIMGatewayManager, getOpenClawRuntimeAdapter, getCoworkSessionTitle } = deps;

  ipcMain.handle(ScheduledTaskIpc.List, async () => {
    try {
      if (!(await ensureScheduledTaskGatewayClient(getOpenClawRuntimeAdapter))) {
        return { success: true, ready: false, tasks: [] };
      }
      const tasks = await getCronJobService().listJobs();
      return { success: true, ready: true, tasks };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list tasks',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Get, async (_event, id: string) => {
    try {
      const task = await getCronJobService().getJob(id);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Create, async (_event, input: any) => {
    try {
      const normalizedInput = input && typeof input === 'object' ? { ...input } : {};
      console.debug('[ScheduledTask] create input:', JSON.stringify(normalizedInput, null, 2));
      await applyAnnounceDeliveryNormalization(normalizedInput, getIMGatewayManager);

      const task = await getCronJobService().addJob(normalizedInput);
      console.log('[IPC][scheduledTask:create] result task id:', task?.id, 'name:', task?.name);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Update, async (_event, id: string, input: any) => {
    try {
      const normalizedInput = input && typeof input === 'object' ? { ...input } : {};
      console.debug(
        '[ScheduledTask] update input id:',
        id,
        JSON.stringify(normalizedInput, null, 2),
      );
      await applyAnnounceDeliveryNormalization(normalizedInput, getIMGatewayManager);

      const task = await getCronJobService().updateJob(id, normalizedInput);
      console.log('[IPC][scheduledTask:update] result task id:', task?.id, 'name:', task?.name);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Delete, async (_event, id: string) => {
    try {
      await getCronJobService().removeJob(id);
      return { success: true, result: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Toggle, async (_event, id: string, enabled: boolean) => {
    try {
      const task = await getCronJobService().toggleJob(id, enabled);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.RunManually, async (_event, id: string) => {
    try {
      await getCronJobService().runJob(id);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Manual run failed for ${id}:`, msg);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Stop, async (_event, _id: string) => {
    // OpenClaw doesn't expose a direct stop API for running cron jobs
    // The job will complete or timeout on its own
    return { success: true, result: false };
  });

  ipcMain.handle(
    ScheduledTaskIpc.ListRuns,
    async (
      _event,
      taskId: string,
      limit?: number,
      offset?: number,
      filter?: import('../../../scheduledTask/types').RunFilter,
    ) => {
      try {
        const runs = await getCronJobService().listRuns(taskId, limit, offset, filter);
        return { success: true, runs };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list runs',
        };
      }
    },
  );

  ipcMain.handle(ScheduledTaskIpc.CountRuns, async (_event, taskId: string) => {
    try {
      const count = await getCronJobService().countRuns(taskId);
      return { success: true, count };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to count runs',
      };
    }
  });

  ipcMain.handle(
    ScheduledTaskIpc.ListAllRuns,
    async (
      _event,
      limit?: number,
      offset?: number,
      filter?: import('../../../scheduledTask/types').RunFilter,
    ) => {
      try {
        if (!(await ensureScheduledTaskGatewayClient(getOpenClawRuntimeAdapter))) {
          return { success: true, ready: false, runs: [] };
        }
        const runs = await getCronJobService().listAllRuns(limit, offset, filter);
        return { success: true, ready: true, runs };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list all runs',
        };
      }
    },
  );

  ipcMain.handle(
    ScheduledTaskIpc.ResolveSession,
    async (
      _event,
      input: string | { sessionId?: string | null; sessionKey?: string | null },
    ) => {
      try {
        const sessionKey = typeof input === 'string' ? input : (input.sessionKey ?? '');
        const sessionId = typeof input === 'string' ? null : (input.sessionId ?? null);
        if (!sessionKey) return { success: true, session: null };
        // Fetch session history from OpenClaw (returns transient session, not persisted)
        const session = await getOpenClawRuntimeAdapter()?.fetchSessionByKey(sessionKey, {
          sessionId,
        });
        return { success: true, session: session ?? null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to resolve session',
        };
      }
    },
  );

  ipcMain.handle(ScheduledTaskIpc.ListChannels, async () => {
    try {
      return { success: true, channels: listScheduledTaskChannels() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list channels',
      };
    }
  });

  ipcMain.handle(
    ScheduledTaskIpc.ListChannelConversations,
    async (_event, channel: string, accountId?: string, filterAccountId?: string) => {
      try {
        const platform = PlatformRegistry.platformOfChannel(channel);
        if (!platform) return { success: true, conversations: [] };
        const imStore = getIMGatewayManager()?.getIMStore();
        if (!imStore) return { success: true, conversations: [] };
        const mappings = imStore.listSessionMappings(platform, filterAccountId ?? accountId);
        const conversations = mappings.map(m => {
          const parsed = parseImConversationId(m.imConversationId);
          const sessionTitle = getCoworkSessionTitle(m.coworkSessionId)?.trim();
          // Channel-synced sessions get auto titles like "[TG] group:123"; only a
          // title the user renamed (no "[...] " prefix) beats the parsed peer id.
          const customTitle =
            sessionTitle && !AUTO_CHANNEL_TITLE_RE.test(sessionTitle) ? sessionTitle : undefined;
          return {
            conversationId: m.imConversationId,
            platform: m.platform,
            coworkSessionId: m.coworkSessionId,
            lastActiveAt: m.lastActiveAt,
            ...(parsed.peerKind ? { peerKind: parsed.peerKind } : {}),
            displayName: customTitle ?? imConversationDisplayName(m.imConversationId),
          };
        });
        return { success: true, conversations };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list conversations',
        };
      }
    },
  );
}
