import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubagentSessionSummary } from '../../types/cowork';

const POLL_INTERVAL_MS = 5_000;

/**
 * Fetches and polls subagent sessions for the currently selected session.
 * Returns a map of parentSessionId → subagent summaries.
 */
export const useSubagentSessions = (
  currentSessionId: string | null,
  currentSessionStatus?: string,
) => {
  const [subagentsBySessionId, setSubagentsBySessionId] = useState<
    Record<string, SubagentSessionSummary[]>
  >({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchedSessionIdRef = useRef<string | null>(null);

  const fetchSubagents = useCallback(async (sessionId: string) => {
    try {
      const result = await window.electron?.cowork?.listSubagentSessions(sessionId);
      if (!result?.success || !result.runs) return;

      const summaries: SubagentSessionSummary[] = result.runs.map((run) => ({
        id: run.id,
        agentId: run.agentId,
        task: run.task,
        label: run.label,
        sessionKey: run.sessionKey,
        parentSessionId: sessionId,
        status: run.status,
        createdAt: run.createdAt,
      }));

      setSubagentsBySessionId((prev) => {
        const existing = prev[sessionId];
        if (existing && JSON.stringify(existing) === JSON.stringify(summaries)) {
          return prev;
        }
        return { ...prev, [sessionId]: summaries };
      });
    } catch {
      // Silently ignore fetch errors
    }
  }, []);

  const removeSubagent = useCallback((parentSessionId: string, runId: string) => {
    setSubagentsBySessionId((prev) => {
      const existing = prev[parentSessionId];
      if (!existing) return prev;
      const next = existing.filter((subagent) => subagent.id !== runId);
      if (next.length === existing.length) return prev;
      return { ...prev, [parentSessionId]: next };
    });
  }, []);

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (!currentSessionId) return;

    // Initial fetch
    lastFetchedSessionIdRef.current = currentSessionId;
    void fetchSubagents(currentSessionId);

    // Poll while parent session is running
    if (currentSessionStatus === 'running') {
      pollingRef.current = setInterval(() => {
        void fetchSubagents(currentSessionId);
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [currentSessionId, currentSessionStatus, fetchSubagents]);

  return { subagentsBySessionId, refetchSubagents: fetchSubagents, removeSubagent };
};
