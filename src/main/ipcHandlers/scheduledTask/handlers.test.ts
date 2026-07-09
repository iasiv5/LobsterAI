import { beforeEach, describe, expect, test, vi } from 'vitest';

const { registeredHandlers } = vi.hoisted(() => ({
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

import {
  DeliveryMode,
  IpcChannel as ScheduledTaskIpc,
  PayloadKind,
  SessionTarget,
  WakeMode,
} from '../../../scheduledTask/constants';
import type { CronJobService } from '../../../scheduledTask/cronJobService';
import { OpenClawEnginePhase } from '../../../shared/openclawEngine/constants';
import { registerScheduledTaskHandlers, type ScheduledTaskHandlerDeps } from './handlers';

function makeDeps(
  enginePhase: OpenClawEnginePhase = OpenClawEnginePhase.Running,
  options: { gatewayClient?: unknown } = {},
) {
  let gatewayClient: unknown = options.gatewayClient ?? null;
  const cronJobService = {
    listJobs: vi.fn(async () => []),
    getJob: vi.fn(async () => null),
    listAllRuns: vi.fn(async () => []),
    addJob: vi.fn(async (input: { name?: string }) => ({ id: 'job-1', name: input?.name ?? '' })),
    updateJob: vi.fn(async (id: string, input: { name?: string }) => ({
      id,
      name: input?.name ?? '',
    })),
    runJob: vi.fn(async () => {}),
  };
  const adapter = {
    getGatewayClient: vi.fn(() => gatewayClient),
    getEngineStatusSnapshot: vi.fn(() => ({ phase: enginePhase })),
    connectGatewayIfNeeded: vi.fn(async () => {
      gatewayClient = {};
    }),
    fetchSessionByKey: vi.fn(async () => null),
  };
  const deps: ScheduledTaskHandlerDeps = {
    getCronJobService: () => cronJobService as unknown as CronJobService,
    getIMGatewayManager: () => null,
    getCoworkSessionTitle: () => null,
    getOpenClawRuntimeAdapter: () => adapter,
  };

  return { adapter, cronJobService, deps };
}

beforeEach(() => {
  registeredHandlers.clear();
});

describe('registerScheduledTaskHandlers', () => {
  test('connects the gateway client before listing scheduled tasks', async () => {
    const { adapter, cronJobService, deps } = makeDeps();
    registerScheduledTaskHandlers(deps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.List);
    expect(handler).toBeDefined();

    const result = await handler?.();

    expect(adapter.connectGatewayIfNeeded).toHaveBeenCalledTimes(1);
    expect(cronJobService.listJobs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, ready: true, tasks: [] });
  });

  test('connects the gateway client before listing scheduled task history', async () => {
    const { adapter, cronJobService, deps } = makeDeps();
    registerScheduledTaskHandlers(deps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.ListAllRuns);
    expect(handler).toBeDefined();

    const result = await handler?.(undefined, 20, 0);

    expect(adapter.connectGatewayIfNeeded).toHaveBeenCalledTimes(1);
    expect(cronJobService.listAllRuns).toHaveBeenCalledWith(20, 0, undefined);
    expect(result).toEqual({ success: true, ready: true, runs: [] });
  });

  test('reports not-ready without blocking while the engine is still starting', async () => {
    const { adapter, cronJobService, deps } = makeDeps(OpenClawEnginePhase.Starting);
    registerScheduledTaskHandlers(deps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.List);
    const result = await handler?.();

    expect(adapter.connectGatewayIfNeeded).not.toHaveBeenCalled();
    expect(cronJobService.listJobs).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, ready: false, tasks: [] });
  });

  test('restores IM delivery target casing and account from gateway sessions on create', async () => {
    const request = vi.fn(async () => ({
      sessions: [
        {
          updatedAt: 2_000,
          lastChannel: 'openclaw-weixin',
          lastTo: 'WxId_ZhangSan@im.wechat',
          lastAccountId: 'weixin-bot-1',
        },
      ],
    }));
    const { cronJobService, deps } = makeDeps(OpenClawEnginePhase.Running, {
      gatewayClient: { request },
    });
    registerScheduledTaskHandlers(deps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.Create);
    const result = await handler?.(undefined, {
      name: '科技早报',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 13 * * *' },
      sessionTarget: SessionTarget.Main,
      wakeMode: WakeMode.Now,
      payload: { kind: PayloadKind.AgentTurn, message: 'hi' },
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'openclaw-weixin',
        to: 'weixin-bot-1:direct:wxid_zhangsan@im.wechat',
      },
    });

    expect(request).toHaveBeenCalledWith(
      'sessions.list',
      expect.objectContaining({ includeGlobal: true }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(cronJobService.addJob).toHaveBeenCalledTimes(1);
    const input = cronJobService.addJob.mock.calls[0][0] as {
      sessionTarget: string;
      delivery: Record<string, unknown>;
    };
    expect(input.sessionTarget).toBe(SessionTarget.Isolated);
    expect(input.delivery).toEqual({
      mode: DeliveryMode.Announce,
      channel: 'openclaw-weixin',
      to: 'WxId_ZhangSan@im.wechat',
      accountId: 'weixin-bot-1',
    });
    expect(result).toEqual({ success: true, task: { id: 'job-1', name: '科技早报' } });
  });

  test('binds the job to the conversation agent for agent-bound IM targets', async () => {
    const { cronJobService, deps } = makeDeps();
    const boundDeps: ScheduledTaskHandlerDeps = {
      ...deps,
      getIMGatewayManager: () => ({
        getIMStore: () => ({
          getSessionMapping: () => undefined,
          listSessionMappings: () => [
            {
              imConversationId: 'popo-bot-1:direct:zhangsan@corp.example.com',
              platform: 'popo',
              coworkSessionId: 'cw-1',
              agentId: 'f15e78b0-agent',
              lastActiveAt: '2',
            },
          ],
        }),
        primeConversationReplyRoute: vi.fn(async () => {}),
      }),
    };
    registerScheduledTaskHandlers(boundDeps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.Create);
    await handler?.(undefined, {
      name: '测试 popo',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 13 * * *' },
      payload: { kind: PayloadKind.AgentTurn, message: 'hi' },
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'moltbot-popo',
        to: 'popo-bot-1:direct:zhangsan@corp.example.com',
        accountId: 'popo-bot-1',
      },
    });

    expect(cronJobService.addJob).toHaveBeenCalledTimes(1);
    const input = cronJobService.addJob.mock.calls[0][0] as {
      agentId?: string;
      delivery: Record<string, unknown>;
    };
    expect(input.agentId).toBe('f15e78b0-agent');
    expect(input.delivery).toEqual({
      mode: DeliveryMode.Announce,
      channel: 'moltbot-popo',
      to: 'zhangsan@corp.example.com',
      accountId: 'popo-bot-1',
    });
  });

  test('binds the job to the selected bot agent for account-less group IM targets', async () => {
    const { cronJobService, deps } = makeDeps();
    const boundDeps: ScheduledTaskHandlerDeps = {
      ...deps,
      getIMGatewayManager: () => ({
        getIMStore: () => ({
          getSessionMapping: () => undefined,
          getIMSettings: () => ({
            platformAgentBindings: {
              'feishu:feishu-bot-1': 'agent-feishu-bot-1',
            },
          }),
          listSessionMappings: () => [
            {
              imConversationId: 'group:oc_zhangsan_group',
              platform: 'feishu',
              coworkSessionId: 'cw-main-group',
              agentId: 'main',
              lastActiveAt: '3',
            },
            {
              imConversationId: 'group:oc_zhangsan_group',
              platform: 'feishu',
              coworkSessionId: 'cw-bot-1-group',
              agentId: 'agent-feishu-bot-1',
              lastActiveAt: '2',
            },
          ],
        }),
        primeConversationReplyRoute: vi.fn(async () => {}),
      }),
    };
    registerScheduledTaskHandlers(boundDeps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.Create);
    await handler?.(undefined, {
      name: 'feishu group',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 13 * * *' },
      payload: { kind: PayloadKind.AgentTurn, message: 'hi' },
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'feishu',
        to: 'group:oc_zhangsan_group',
        accountId: 'feishu-bot-1',
      },
    });

    expect(cronJobService.addJob).toHaveBeenCalledTimes(1);
    const input = cronJobService.addJob.mock.calls[0][0] as {
      agentId?: string;
      delivery: Record<string, unknown>;
    };
    expect(input.agentId).toBe('agent-feishu-bot-1');
    expect(input.delivery).toEqual({
      mode: DeliveryMode.Announce,
      channel: 'feishu',
      to: 'oc_zhangsan_group',
      accountId: 'feishu-bot-1',
    });
  });

  test('migrates an existing IM group job before manual run without gateway session lookup', async () => {
    const request = vi.fn(async () => ({ sessions: [] }));
    const { cronJobService, deps } = makeDeps(OpenClawEnginePhase.Running, {
      gatewayClient: { request },
    });
    cronJobService.getJob.mockResolvedValue({
      id: 'job-1',
      name: 'legacy feishu group',
      description: '',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 13 * * *' },
      sessionTarget: SessionTarget.Main,
      wakeMode: WakeMode.Now,
      payload: { kind: PayloadKind.AgentTurn, message: 'hi' },
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'feishu',
        to: 'oc_zhangsan_group',
        accountId: 'feishu-bot-1',
      },
      agentId: 'main',
      sessionKey: null,
      state: {
        nextRunAtMs: null,
        lastRunAtMs: null,
        lastStatus: null,
        lastError: null,
        lastDurationMs: null,
        runningAtMs: null,
        consecutiveErrors: 0,
      },
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    });
    const boundDeps: ScheduledTaskHandlerDeps = {
      ...deps,
      getIMGatewayManager: () => ({
        getIMStore: () => ({
          getSessionMapping: () => undefined,
          getIMSettings: () => ({
            platformAgentBindings: {
              'feishu:feishu-bot-1': 'agent-feishu-bot-1',
            },
          }),
          listSessionMappings: () => [
            {
              imConversationId: 'group:oc_zhangsan_group',
              platform: 'feishu',
              coworkSessionId: 'cw-main-group',
              agentId: 'main',
              lastActiveAt: '3',
            },
            {
              imConversationId: 'group:oc_zhangsan_group',
              platform: 'feishu',
              coworkSessionId: 'cw-bot-1-group',
              agentId: 'agent-feishu-bot-1',
              lastActiveAt: '2',
            },
          ],
        }),
        primeConversationReplyRoute: vi.fn(async () => {}),
      }),
    };
    registerScheduledTaskHandlers(boundDeps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.RunManually);
    const result = await handler?.(undefined, 'job-1');

    expect(result).toEqual({ success: true });
    expect(cronJobService.updateJob).toHaveBeenCalledWith('job-1', {
      sessionTarget: SessionTarget.Isolated,
      agentId: 'agent-feishu-bot-1',
    });
    expect(cronJobService.runJob).toHaveBeenCalledWith('job-1');
    expect(request).not.toHaveBeenCalled();
  });

  test('filters account-less group conversation options by the selected bot agent binding', async () => {
    const { deps } = makeDeps();
    const listSessionMappings = vi.fn(() => [
      {
        imConversationId: 'feishu-bot-1:direct:oc_zhangsan_group',
        platform: 'feishu',
        coworkSessionId: 'cw-poisoned-direct',
        agentId: 'agent-feishu-bot-1',
        lastActiveAt: '4',
      },
      {
        imConversationId: 'group:oc_zhangsan_group',
        platform: 'feishu',
        coworkSessionId: 'cw-main-group',
        agentId: 'main',
        lastActiveAt: '3',
      },
      {
        imConversationId: 'group:oc_zhangsan_group',
        platform: 'feishu',
        coworkSessionId: 'cw-bot-1-group',
        agentId: 'agent-feishu-bot-1',
        lastActiveAt: '2',
      },
      {
        imConversationId: 'feishu-bot-1:direct:ou_lisi',
        platform: 'feishu',
        coworkSessionId: 'cw-bot-1-dm',
        agentId: 'agent-feishu-bot-1',
        lastActiveAt: '1',
      },
    ]);
    const boundDeps: ScheduledTaskHandlerDeps = {
      ...deps,
      getIMGatewayManager: () => ({
        getIMStore: () => ({
          getSessionMapping: () => undefined,
          getIMSettings: () => ({
            platformAgentBindings: {
              'feishu:feishu-bot-1': 'agent-feishu-bot-1',
            },
          }),
          listSessionMappings,
        }),
        primeConversationReplyRoute: vi.fn(async () => {}),
      }),
    };
    registerScheduledTaskHandlers(boundDeps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.ListChannelConversations);
    const result = await handler?.(undefined, 'feishu', 'feishu-bot-1', 'feishu-bot-1');

    expect(listSessionMappings).toHaveBeenCalledWith('feishu', 'feishu-bot-1');
    expect(result).toEqual({
      success: true,
      conversations: [
        {
          conversationId: 'group:oc_zhangsan_group',
          platform: 'feishu',
          coworkSessionId: 'cw-bot-1-group',
          lastActiveAt: '2',
          peerKind: 'group',
          displayName: 'oc_zhangsan_group',
        },
        {
          conversationId: 'feishu-bot-1:direct:ou_lisi',
          platform: 'feishu',
          coworkSessionId: 'cw-bot-1-dm',
          lastActiveAt: '1',
          peerKind: 'direct',
          displayName: 'ou_lisi',
        },
      ],
    });
  });

  test('keeps the stripped delivery target when gateway sessions are unavailable', async () => {
    const { cronJobService, deps } = makeDeps();
    registerScheduledTaskHandlers(deps);

    const handler = registeredHandlers.get(ScheduledTaskIpc.Create);
    await handler?.(undefined, {
      name: 'weather',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 13 * * *' },
      payload: { kind: PayloadKind.AgentTurn, message: 'hi' },
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'openclaw-weixin',
        to: 'direct:wxid_zhangsan@im.wechat',
      },
    });

    expect(cronJobService.addJob).toHaveBeenCalledTimes(1);
    const input = cronJobService.addJob.mock.calls[0][0] as { delivery: Record<string, unknown> };
    expect(input.delivery).toEqual({
      mode: DeliveryMode.Announce,
      channel: 'openclaw-weixin',
      to: 'wxid_zhangsan@im.wechat',
    });
  });
});
