import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectCurrentSessionId } from '../../store/selectors/coworkSelectors';
import type { SubagentSessionSummary } from '../../types/cowork';
import { isDefaultAgentId } from '../../utils/agentDisplay';
import AgentCreateModal from '../agent/AgentCreateModal';
import AgentSettingsPanel from '../agent/AgentSettingsPanel';
import { type CoworkOpenShareOptionsEventDetail,CoworkUiEvent } from '../cowork/constants';
import AgentTreeNode from './AgentTreeNode';
import MyAgentSidebarHeader from './MyAgentSidebarHeader';
import type { AgentSidebarAgentNode, AgentSidebarTaskNode } from './types';
import { useAgentSidebarState } from './useAgentSidebarState';
import { useSubagentSessions } from './useSubagentSessions';

interface MyAgentSidebarTreeProps {
  isBatchMode: boolean;
  batchAgentId: string | null;
  deletedSessionIds: string[];
  selectedIds: Set<string>;
  onShowCowork: () => void;
  onToggleSelection: (sessionId: string, agentId: string) => void;
  onEnterBatchMode: (sessionId: string, agentId: string) => void;
  onBatchSelectableIdsChange: (sessionIds: string[]) => void;
  onSelectSubagent?: (subagent: SubagentSessionSummary) => void;
}

const MyAgentSidebarTree: React.FC<MyAgentSidebarTreeProps> = ({
  isBatchMode,
  batchAgentId,
  deletedSessionIds,
  selectedIds,
  onShowCowork,
  onToggleSelection,
  onEnterBatchMode,
  onBatchSelectableIdsChange,
  onSelectSubagent,
}) => {
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const currentSessionStatus = useSelector(
    (state: RootState) => state.cowork.currentSession?.status,
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const { subagentsBySessionId, refetchSubagents, removeSubagent } = useSubagentSessions(
    currentSessionId,
    currentSessionStatus,
  );
  const {
    agentNodes,
    patchTaskPreview,
    removeTaskPreview,
    removeTaskPreviews,
    removeAgentTaskPreviews,
    retryLoadTasks,
    loadMoreTasks,
    collapseTasks,
    toggleAgentExpanded,
  } = useAgentSidebarState();

  useEffect(() => {
    void agentService.loadAgents();
  }, []);

  // Listen for subagent selection events to track active subagent in sidebar
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SubagentSessionSummary | null>).detail;
      setSelectedSubagentId(detail?.id ?? null);
      // Refetch subagent data when navigating back from detail view
      if (!detail && currentSessionId) {
        void refetchSubagents(currentSessionId);
      }
    };
    window.addEventListener(CoworkUiEvent.SelectSubagent, handler);
    return () => window.removeEventListener(CoworkUiEvent.SelectSubagent, handler);
  }, [currentSessionId, refetchSubagents]);

  const handleSelectTask = async (task: AgentSidebarTaskNode) => {
    if (task.agentId !== currentAgentId) {
      agentService.switchAgent(task.agentId);
      await coworkService.loadSessions(task.agentId);
    }
    onShowCowork();
    // Clear subagent detail view so the main session detail is shown
    window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, { detail: null }));
    return coworkService.loadSession(task.id);
  };

  const handleDeleteTask = async (task: AgentSidebarTaskNode) => {
    const deleted = await coworkService.deleteSession(task.id);
    if (deleted) {
      removeTaskPreview(task.id);
    }
  };

  const handleDeleteSubagent = async (subagent: SubagentSessionSummary) => {
    if (!subagent.parentSessionId) return;

    const deleted = await coworkService.deleteSubagentSession(subagent.parentSessionId, subagent.id);
    if (deleted) {
      removeSubagent(subagent.parentSessionId, subagent.id);
      if (selectedSubagentId === subagent.id) {
        window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, { detail: null }));
      }
    }
  };

  const handleToggleTaskPin = async (task: AgentSidebarTaskNode, pinned: boolean) => {
    const result = await coworkService.setSessionPinned(task.id, pinned);
    if (result.success) {
      patchTaskPreview(task.id, { pinned, pinOrder: result.pinOrder }, { preserveUpdatedAt: true });
    }
  };

  const handleRenameTask = async (task: AgentSidebarTaskNode, title: string) => {
    const renamed = await coworkService.renameSession(task.id, title);
    if (renamed) {
      patchTaskPreview(task.id, { title }, { preserveUpdatedAt: true });
    }
  };

  const handleShareTask = async (task: AgentSidebarTaskNode) => {
    const session = await handleSelectTask(task);
    if (!session) return;

    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<CoworkOpenShareOptionsEventDetail>(
        CoworkUiEvent.OpenShareOptions,
        { detail: { sessionId: task.id } },
      ));
    }, 0);
  };

  const handleForkTask = async (task: AgentSidebarTaskNode) => {
    if (task.status === 'running') {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkForkRunningBlocked'),
      }));
      return;
    }
    if (task.agentId !== currentAgentId) {
      agentService.switchAgent(task.agentId);
      await coworkService.loadSessions(task.agentId);
    }
    const result = await coworkService.forkSession({ sessionId: task.id });
    if (!result.session) return;
    onShowCowork();
  };

  const handleEnterBatchMode = (task: AgentSidebarTaskNode) => {
    if (task.agentId !== currentAgentId) {
      agentService.switchAgent(task.agentId);
      void coworkService.loadSessions(task.agentId);
    }
    onEnterBatchMode(task.id, task.agentId);
  };

  const handleCreateTask = async (agent: AgentSidebarAgentNode) => {
    if (agent.id !== currentAgentId) {
      agentService.switchAgent(agent.id);
      await coworkService.loadSessions(agent.id);
    }
    coworkService.clearSession({ restoreAgentSkills: true });
    onShowCowork();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: false },
      }));
    }, 0);
  };

  const handleDeleteAgent = async (agent: AgentSidebarAgentNode) => {
    if (isDefaultAgentId(agent.id)) return;
    const deleted = await agentService.deleteAgent(agent.id);
    if (deleted) {
      removeAgentTaskPreviews(agent.id);
    }
    if (deleted && settingsAgentId === agent.id) {
      setSettingsAgentId(null);
    }
    if (!deleted) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentDeleteFailed') }));
    }
  };

  const handleToggleAgentPin = async (agent: AgentSidebarAgentNode, pinned: boolean) => {
    const updated = await agentService.updateAgent(agent.id, { pinned });
    if (!updated) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentPinFailed') }));
    }
  };

  const renderAgentNode = (agent: AgentSidebarAgentNode) => (
    <AgentTreeNode
      key={agent.id}
      agent={agent}
      isBatchMode={isBatchMode}
      batchAgentId={batchAgentId}
      selectedIds={selectedIds}
      showBatchOption
      subagentsBySessionId={subagentsBySessionId}
      selectedSubagentId={selectedSubagentId}
      onSelectSubagent={(sub) => {
        onSelectSubagent?.(sub);
        onShowCowork();
        window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, { detail: sub }));
      }}
      onDeleteSubagent={handleDeleteSubagent}
      onToggleExpanded={toggleAgentExpanded}
      onEditAgent={(agent) => setSettingsAgentId(agent.id)}
      onCreateTask={(agent) => void handleCreateTask(agent)}
      onDeleteAgent={handleDeleteAgent}
      onToggleAgentPin={handleToggleAgentPin}
      onRetryLoadTasks={(agentId) => void retryLoadTasks(agentId)}
      onLoadMoreTasks={(agentId) => void loadMoreTasks(agentId)}
      onCollapseTasks={collapseTasks}
      onSelectTask={(task) => void handleSelectTask(task)}
      onDeleteTask={handleDeleteTask}
      onForkTask={handleForkTask}
      onShareTask={handleShareTask}
      onToggleTaskPin={handleToggleTaskPin}
      onRenameTask={handleRenameTask}
      onToggleSelection={onToggleSelection}
      onEnterBatchMode={handleEnterBatchMode}
    />
  );

  const pinnedAgentNodes = agentNodes.filter((agent) => agent.pinned);
  const projectAgentNodes = agentNodes.filter((agent) => !agent.pinned);
  const hasPinnedAgents = pinnedAgentNodes.length > 0;

  useEffect(() => {
    if (deletedSessionIds.length === 0) return;
    removeTaskPreviews(deletedSessionIds);
  }, [deletedSessionIds, removeTaskPreviews]);

  useEffect(() => {
    if (!batchAgentId) {
      onBatchSelectableIdsChange([]);
      return;
    }

    const batchAgent = agentNodes.find((agent) => agent.id === batchAgentId);
    onBatchSelectableIdsChange(batchAgent?.tasks.map((task) => task.id) ?? []);
  }, [agentNodes, batchAgentId, onBatchSelectableIdsChange]);

  return (
    <div className="pb-3" role="tree" aria-label={i18nService.t('myAgents')}>
      {hasPinnedAgents && (
        <div className="space-y-0.5">
          <div className="sticky top-0 z-30 flex h-10 items-center bg-surface-raised px-1.5">
            <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
              {i18nService.t('myAgentSidebarPinned')}
            </h2>
          </div>
          {pinnedAgentNodes.map(renderAgentNode)}
        </div>
      )}

      <MyAgentSidebarHeader
        onCreateAgent={() => setIsCreateOpen(true)}
      />

      {agentNodes.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs font-medium text-secondary">
            {i18nService.t('myAgentSidebarNoAgents')}
          </p>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
          >
            {i18nService.t('createNewAgent')}
          </button>
        </div>
      ) : projectAgentNodes.length > 0 ? (
        <div className="space-y-0.5 px-0">
          {projectAgentNodes.map(renderAgentNode)}
        </div>
      ) : null}

      <AgentCreateModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
      />
    </div>
  );
};

export default MyAgentSidebarTree;
