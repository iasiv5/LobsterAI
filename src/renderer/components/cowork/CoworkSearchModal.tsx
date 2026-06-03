import { XMarkIcon } from '@heroicons/react/24/outline';
import { AgentId } from '@shared/agent';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import { getAgentDisplayNameById } from '../../utils/agentDisplay';
import Modal from '../common/Modal';

const SEARCH_SESSION_LIMIT = 100;

const getSessionAgentId = (session: CoworkSessionSummary) => {
  return session.agentId?.trim() || AgentId.Main;
};

interface CoworkSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: CoworkSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (session: CoworkSessionSummary) => void | Promise<void>;
}

const CoworkSearchModal: React.FC<CoworkSearchModalProps> = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSelectSession,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSessions, setSearchSessions] = useState<CoworkSessionSummary[]>(sessions);
  const [isLoading, setIsLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const agentNameBySessionId = useMemo(() => {
    const names = new Map<string, string>();
    searchSessions.forEach((session) => {
      const agentId = getSessionAgentId(session);
      names.set(session.id, getAgentDisplayNameById(agentId, agents) ?? agentId);
    });
    return names;
  }, [agents, searchSessions]);

  const filteredSessions = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    if (!trimmedQuery) return searchSessions;
    return searchSessions.filter((session) => {
      const agentName = agentNameBySessionId.get(session.id) ?? '';
      return session.title.toLowerCase().includes(trimmedQuery)
        || agentName.toLowerCase().includes(trimmedQuery);
    });
  }, [agentNameBySessionId, searchQuery, searchSessions]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return;
    }
    setSearchQuery('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearchSessions(sessions);
    }
  }, [isOpen, sessions]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    void coworkService.listSessionsForSearch(SEARCH_SESSION_LIMIT, 0)
      .then((result) => {
        if (cancelled || !result.success || !result.sessions) return;
        setSearchSessions(result.sessions);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSelectSession = async (session: CoworkSessionSummary) => {
    await onSelectSession(session);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-start justify-center bg-black/10 px-6 pt-[18vh] backdrop-blur-[1px] dark:bg-black/30"
      className="modal-content w-full max-w-[520px] overflow-hidden rounded-[18px] border border-border bg-white shadow-modal dark:bg-surface"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={i18nService.t('search')}
      >
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
          <div className="min-w-0 text-base font-semibold text-foreground">
            {i18nService.t('search')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={i18nService.t('close')}
            title={i18nService.t('close')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 pb-3">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={i18nService.t('searchConversations')}
            aria-label={i18nService.t('search')}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder-secondary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="px-2 pb-2">
          <div className="px-2 pb-1 text-[12px] text-secondary">
            {i18nService.t('searchRecentTasks')}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {filteredSessions.length === 0 ? (
              <div className="py-10 text-center text-sm text-secondary">
                {isLoading ? i18nService.t('loading') : i18nService.t('searchNoResults')}
              </div>
            ) : (
              filteredSessions.map((session) => {
                const agentName = agentNameBySessionId.get(session.id) ?? getSessionAgentId(session);
                const isSelected = session.id === currentSessionId;
                const isRunning = session.status === CoworkSessionStatusValue.Running;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => void handleSelectSession(session)}
                    className={`group flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors ${
                      isSelected
                        ? 'bg-black/[0.06] text-foreground dark:bg-white/[0.07]'
                        : 'text-secondary hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]'
                      }`}
                  >
                    {isRunning && (
                      <span
                        className="inline-flex h-3 w-3 shrink-0 items-center justify-center"
                        title={i18nService.t('myAgentSidebarRunning')}
                        aria-label={i18nService.t('myAgentSidebarRunning')}
                      >
                        <svg className="h-3 w-3 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                          />
                        </svg>
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {session.title}
                    </span>
                    <span className="max-w-[136px] shrink-0 truncate text-[12px] text-secondary/75">
                      {agentName}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CoworkSearchModal;
