export const AgentSidebarBatchItemKind = {
  Session: 'session',
  Subagent: 'subagent',
} as const;
export type AgentSidebarBatchItemKind =
  typeof AgentSidebarBatchItemKind[keyof typeof AgentSidebarBatchItemKind];

export interface AgentSidebarSessionBatchItem {
  kind: typeof AgentSidebarBatchItemKind.Session;
  key: string;
  sessionId: string;
}

export interface AgentSidebarSubagentBatchItem {
  kind: typeof AgentSidebarBatchItemKind.Subagent;
  key: string;
  parentSessionId: string;
  runId: string;
}

export type AgentSidebarBatchItem =
  | AgentSidebarSessionBatchItem
  | AgentSidebarSubagentBatchItem;

export const createSessionBatchKey = (sessionId: string): string => (
  `${AgentSidebarBatchItemKind.Session}:${encodeURIComponent(sessionId)}`
);

export const createSubagentBatchKey = (parentSessionId: string, runId: string): string => (
  `${AgentSidebarBatchItemKind.Subagent}:${encodeURIComponent(parentSessionId)}:${encodeURIComponent(runId)}`
);

export const createSessionBatchItem = (sessionId: string): AgentSidebarSessionBatchItem => ({
  kind: AgentSidebarBatchItemKind.Session,
  key: createSessionBatchKey(sessionId),
  sessionId,
});

export const createSubagentBatchItem = (
  parentSessionId: string,
  runId: string,
): AgentSidebarSubagentBatchItem => ({
  kind: AgentSidebarBatchItemKind.Subagent,
  key: createSubagentBatchKey(parentSessionId, runId),
  parentSessionId,
  runId,
});
