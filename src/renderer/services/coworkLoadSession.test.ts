import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { store } from '../store';
import { setCurrentSession, setMessageWindow } from '../store/slices/coworkSlice';
import {
  type CoworkMessage,
  type CoworkSession,
  CoworkSessionStatusValue,
} from '../types/cowork';
import { coworkService } from './cowork';

const makeMessages = (count: number): CoworkMessage[] => Array.from(
  { length: count },
  (_, index) => ({
    id: `message-${index}`,
    type: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
    timestamp: index,
  }),
);

const makeSession = (
  messages: CoworkMessage[],
  messagesOffset: number,
  totalMessages: number,
): CoworkSession => ({
  id: 'session-1',
  title: 'Session 1',
  claudeSessionId: null,
  status: CoworkSessionStatusValue.Completed,
  pinned: false,
  pinOrder: null,
  cwd: '/tmp',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local',
  activeSkillIds: [],
  agentId: 'main',
  messages,
  messagesOffset,
  totalMessages,
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(() => {
  coworkService.clearSession();
});

afterEach(() => {
  coworkService.clearSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('coworkService.loadSession', () => {
  test('preserves history already loaded before the default 30-message window', async () => {
    const allMessages = makeMessages(39);
    const defaultPageSession = makeSession(allMessages.slice(9), 9, 39);
    store.dispatch(setCurrentSession(makeSession(allMessages, 0, 39)));

    const getSession = vi.fn(async () => ({ success: true, session: defaultPageSession }));
    const getSessionMessages = vi.fn(async () => ({
      success: true,
      messages: allMessages,
      offset: 0,
      total: 39,
    }));
    vi.stubGlobal('window', {
      electron: {
        cowork: {
          getSession,
          getSessionMessages,
          remoteManaged: vi.fn(async () => ({ remoteManaged: false })),
        },
      },
    });

    const result = await coworkService.loadSession('session-1', {
      preserveLoadedRange: true,
    });

    expect(getSessionMessages).toHaveBeenCalledWith({
      sessionId: 'session-1',
      offset: 0,
      limit: 39,
    });
    expect(result?.messages).toHaveLength(39);
    expect(result?.messagesOffset).toBe(0);
    expect(store.getState().cowork.currentSession?.messages).toHaveLength(39);
    expect(store.getState().cowork.currentSession?.messagesOffset).toBe(0);
  });

  test('does not request another message page when no earlier history was loaded', async () => {
    const allMessages = makeMessages(39);
    const defaultPageSession = makeSession(allMessages.slice(9), 9, 39);
    store.dispatch(setCurrentSession(defaultPageSession));

    const getSessionMessages = vi.fn();
    vi.stubGlobal('window', {
      electron: {
        cowork: {
          getSession: vi.fn(async () => ({ success: true, session: defaultPageSession })),
          getSessionMessages,
          remoteManaged: vi.fn(async () => ({ remoteManaged: false })),
        },
      },
    });

    await coworkService.loadSession('session-1', { preserveLoadedRange: true });

    expect(getSessionMessages).not.toHaveBeenCalled();
  });

  test('keeps the existing history view when preserving the loaded page fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const allMessages = makeMessages(39);
    const fullyLoadedSession = makeSession(allMessages, 0, 39);
    const defaultPageSession = makeSession(allMessages.slice(9), 9, 39);
    store.dispatch(setCurrentSession(fullyLoadedSession));

    vi.stubGlobal('window', {
      electron: {
        cowork: {
          getSession: vi.fn(async () => ({ success: true, session: defaultPageSession })),
          getSessionMessages: vi.fn(async () => {
            throw new Error('message page unavailable');
          }),
          remoteManaged: vi.fn(async () => ({ remoteManaged: false })),
        },
      },
    });

    const result = await coworkService.loadSession('session-1', {
      preserveLoadedRange: true,
    });

    expect(result).toStrictEqual(fullyLoadedSession);
    expect(store.getState().cowork.currentSession?.messages).toHaveLength(39);
    expect(store.getState().cowork.currentSession?.messagesOffset).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('keeping the existing view'),
      expect.any(Error),
    );
  });

  test('does not overwrite history that advances while a preserved page is loading', async () => {
    const allMessages = makeMessages(39);
    const messagesWithLiveUpdate = makeMessages(40);
    const defaultPageSession = makeSession(allMessages.slice(9), 9, 39);
    store.dispatch(setCurrentSession(makeSession(allMessages, 0, 39)));

    vi.stubGlobal('window', {
      electron: {
        cowork: {
          getSession: vi.fn(async () => ({ success: true, session: defaultPageSession })),
          getSessionMessages: vi.fn(async () => {
            store.dispatch(setMessageWindow({
              sessionId: 'session-1',
              messages: messagesWithLiveUpdate,
              messagesOffset: 0,
              totalMessages: 40,
            }));
            return {
              success: true,
              messages: allMessages,
              offset: 0,
              total: 39,
            };
          }),
          remoteManaged: vi.fn(async () => ({ remoteManaged: false })),
        },
      },
    });

    const result = await coworkService.loadSession('session-1', {
      preserveLoadedRange: true,
    });

    expect(result?.messages).toHaveLength(40);
    expect(result?.totalMessages).toBe(40);
    expect(store.getState().cowork.currentSession?.messages).toHaveLength(40);
  });
});
