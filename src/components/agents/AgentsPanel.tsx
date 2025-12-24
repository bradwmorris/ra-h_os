"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import RAHChat from './RAHChat';
import QuickAddInput from './QuickAddInput';
import QuickAddStatus from './QuickAddStatus';
import { Zap, Flame, Minimize2 } from 'lucide-react';
import type { AgentDelegation } from '@/services/agents/delegation';
import { Node } from '@/types/database';

interface AgentsPanelProps {
  openTabsData: Node[];
  activeTabId: number | null;
  onNodeClick?: (nodeId: number) => void;
  onCollapse?: () => void;
}

type ActiveTab = 'ra-h' | string; // 'ra-h' or delegation sessionId
type Mode = 'quickadd' | 'session';

export default function AgentsPanel({ openTabsData, activeTabId, onNodeClick, onCollapse }: AgentsPanelProps) {
  const [delegationsMap, setDelegationsMap] = useState<Record<string, AgentDelegation>>({});
  const [activeAgentTab, setActiveAgentTab] = useState<ActiveTab>('ra-h');
  const [mode, setMode] = useState<Mode>('quickadd');
  const [rahMode, setRahMode] = useState<'easy' | 'hard'>('easy');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  // Lift messages state to prevent losing it on tab switch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rahMessages, setRahMessages] = useState<any[]>([]);
  
  // Store delegation messages per sessionId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [delegationMessages, setDelegationMessages] = useState<Record<string, any[]>>({});

  const getDelegationMessages = useCallback((sessionId: string) => {
    return delegationMessages[sessionId] || [];
  }, [delegationMessages]);
  
  const setDelegationMessagesFor = useCallback((sessionId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (updater: (prev: any[]) => any[]) => {
      setDelegationMessages(prev => ({
        ...prev,
        [sessionId]: updater(prev[sessionId] || [])
      }));
    };
  }, []);

  const upsertDelegation = useCallback((delegation: AgentDelegation) => {
    setDelegationsMap((prev) => ({
      ...prev,
      [delegation.sessionId]: delegation,
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadExisting = async () => {
      try {
        const response = await fetch('/api/rah/delegations?status=active&includeCompleted=true');
        if (!response.ok) return;
        const data = await response.json();
        if (!Array.isArray(data.delegations)) return;

        setDelegationsMap((prev) => {
          if (cancelled) return prev;
          const next = { ...prev };
          for (const delegation of data.delegations as AgentDelegation[]) {
            next[delegation.sessionId] = delegation;
          }
          return next;
        });
      } catch (error) {
        console.error('[AgentsPanel] Failed to load delegations:', error);
      }
    };

    loadExisting();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('rah-mode');
    if (stored === 'easy' || stored === 'hard') {
      setRahMode(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('rah-mode', rahMode);
  }, [rahMode]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ mode: 'easy' | 'hard' }>).detail;
      if (detail?.mode) {
        setRahMode(detail.mode);
      }
    };
    const quickAddHandler = () => setMode('quickadd');
    window.addEventListener('rah:mode-toggle', handler as EventListener);
    window.addEventListener('rah:switch-quickadd', quickAddHandler);
    return () => {
      window.removeEventListener('rah:mode-toggle', handler as EventListener);
      window.removeEventListener('rah:switch-quickadd', quickAddHandler);
    };
  }, []);


  useEffect(() => {
    const handleCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ delegation: AgentDelegation }>).detail;
      console.log('[AgentsPanel] Delegation created:', detail?.delegation);
      if (detail?.delegation) upsertDelegation(detail.delegation);
    };
    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ delegation: AgentDelegation }>).detail;
      console.log('[AgentsPanel] Delegation updated:', detail?.delegation);
      if (detail?.delegation) upsertDelegation(detail.delegation);
    };

    window.addEventListener('delegations:created', handleCreated as EventListener);
    window.addEventListener('delegations:updated', handleUpdated as EventListener);
    return () => {
      window.removeEventListener('delegations:created', handleCreated as EventListener);
      window.removeEventListener('delegations:updated', handleUpdated as EventListener);
    };
  }, [upsertDelegation]);

  const delegations = useMemo(() => Object.values(delegationsMap), [delegationsMap]);

  const orderedDelegations = useMemo(() => {
    const statusWeight = (status: AgentDelegation['status']) => {
      switch (status) {
        case 'queued':
          return 0;
        case 'in_progress':
          return 1;
        case 'completed':
          return 2;
        case 'failed':
        default:
          return 3;
      }
    };

    // No staleness filtering - delegations persist until user closes them
    const ordered = delegations.sort((a, b) => {
      const diff = statusWeight(a.status) - statusWeight(b.status);
      if (diff !== 0) return diff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const wise = ordered.filter((d) => d.agentType === 'wise-rah');
    const mini = ordered.filter((d) => d.agentType !== 'wise-rah');

    return [...wise, ...mini];
  }, [delegations]);

  // Don't auto-switch tabs - user stays in ra-h to see responses

  const selectedDelegation = orderedDelegations.find(d => d.sessionId === activeAgentTab);

  const handleQuickAddSubmit = async ({ input, mode }: { input: string; mode: 'link' | 'note' | 'chat' }) => {
    try {
      const response = await fetch('/api/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, mode })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit Quick Add');
      }
    } catch (error) {
      console.error('[AgentsPanel] Quick Add error:', error);
    }
  };

  const handleDelegationClick = (sessionId: string) => {
    setActiveAgentTab(sessionId);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'transparent', position: 'relative' }}>
      {/* Mode Header */}
      {mode === 'quickadd' ? (
        <div style={{
          padding: '20px',
          background: 'transparent',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative'
        }}>
          {/* Top Bar - just collapse button */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            marginBottom: '24px'
          }}>
            {onCollapse && (
              <button
                onClick={onCollapse}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  border: '1px solid #1f1f1f',
                  background: 'transparent',
                  color: '#666',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title="Collapse chat panel (⌘\)"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#1a1a1a';
                  e.currentTarget.style.color = '#999';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#666';
                }}
              >
                <Minimize2 size={14} />
              </button>
            )}
          </div>

          {/* Center Section - Start button centered */}
          <div style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <button
              onClick={() => {
                setMode('session');
                setRahMode('easy');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '0',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                const text = e.currentTarget.querySelector('.start-text') as HTMLElement;
                const icon = e.currentTarget.querySelector('.start-icon') as HTMLElement;
                if (text) text.style.color = '#22c55e';
                if (icon) {
                  icon.style.transform = 'translateY(-3px)';
                  icon.style.boxShadow = '0 8px 20px rgba(34, 197, 94, 0.3), 0 0 0 4px rgba(34, 197, 94, 0.1)';
                }
              }}
              onMouseLeave={(e) => {
                const text = e.currentTarget.querySelector('.start-text') as HTMLElement;
                const icon = e.currentTarget.querySelector('.start-icon') as HTMLElement;
                if (text) text.style.color = '#737373';
                if (icon) {
                  icon.style.transform = 'translateY(0)';
                  icon.style.boxShadow = '0 0 0 0 rgba(34, 197, 94, 0)';
                }
              }}
            >
              <span 
                className="start-text"
                style={{
                  color: '#737373',
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  transition: 'color 0.2s ease'
                }}
              >
                Start
              </span>
              <div 
                className="start-icon"
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  background: '#22c55e',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: '0 0 0 0 rgba(34, 197, 94, 0)'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5"/>
                  <path d="M5 12l7-7 7 7"/>
                </svg>
              </div>
            </button>
          </div>

          {/* Quick Add - at bottom, full width with padding */}
          <div style={{ width: '100%', padding: '0 16px 16px 16px' }}>
            <QuickAddInput
              activeDelegations={orderedDelegations}
              onSubmit={handleQuickAddSubmit}
            />
          </div>
        </div>
      ) : null}

      {/* Tab Bar (only show in session mode) */}
      {mode === 'session' && (
        <div className="agent-tabs" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {/* Collapse button - first item */}
        {onCollapse && (
          <button
            onClick={onCollapse}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: '1px solid #1f1f1f',
              background: 'transparent',
              color: '#666',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginRight: '8px',
              flexShrink: 0
            }}
            title="Collapse chat panel (⌘\)"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.color = '#999';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#666';
            }}
          >
            <Minimize2 size={14} />
          </button>
        )}
        {/* Capture button - positioned at far right */}
        <div style={{
          position: 'absolute',
          top: '50%',
          right: '12px',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 20
        }}>
          <button
            onClick={() => setMode('quickadd')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid #1f1f1f',
              borderRadius: '6px',
              color: '#e5e5e5',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: 'inherit',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.borderColor = '#2a2a2a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = '#1f1f1f';
            }}
          >
            <span style={{ 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: '#22c55e',
              color: '#0a0a0a',
              fontSize: '12px',
              lineHeight: 1,
              fontWeight: 600,
              flexShrink: 0
            }}>+</span>
            Capture
          </button>
        </div>
        
        {/* RA-H Main Tab */}
        <button
          onClick={() => setActiveAgentTab('ra-h')}
          className={`agent-tab ${activeAgentTab === 'ra-h' ? 'active' : ''}`}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: rahMode === 'easy' ? '#22c55e' : '#f97316' }}>
            {(rahMode === 'easy' ? <Zap size={12} strokeWidth={2.4} /> : <Flame size={12} strokeWidth={2.4} />)}
            <span>RA-H · {rahMode === 'easy' ? 'Easy' : 'Hard'}</span>
          </span>
        </button>

        {/* Delegation Tabs */}
        {orderedDelegations.map((delegation) => {
          const isActive = activeAgentTab === delegation.sessionId;
          const isWiseRAH = delegation.agentType === 'wise-rah';
          
          // Status colors based on agent type
          const statusColor = isWiseRAH 
            ? (delegation.status === 'in_progress' ? '#8b5cf6' : 
               delegation.status === 'completed' ? '#6b6b6b' : 
               delegation.status === 'failed' ? '#ff6b6b' : '#a78bfa')
            : (delegation.status === 'in_progress' ? '#8bd450' : 
               delegation.status === 'completed' ? '#6b6b6b' : 
               delegation.status === 'failed' ? '#ff6b6b' : '#5c9aff');
          
          const shortId = delegation.sessionId.split('_').pop() || '';
          const tabLabel = isWiseRAH 
            ? `WISE RA-H · ${shortId.slice(0, 6)}`
            : `MINI · ${shortId.slice(0, 6)}`;
          
          return (
            <div
              key={delegation.sessionId}
              className={`agent-tab-wrapper ${isWiseRAH ? 'wise' : 'mini'} ${isActive ? 'active' : ''}`}
            >
              <button
                onClick={() => setActiveAgentTab(delegation.sessionId)}
                className="agent-tab"
              >
                <span className="status-dot" style={{ background: statusColor }} />
                <span className="agent-tab-label">{tabLabel}</span>
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  console.log(`[AgentsPanel] User clicked close button for delegation ${delegation.sessionId}`);
                  
                  // Delete from database
                  try {
                    await fetch(`/api/rah/delegations/${delegation.sessionId}`, { method: 'DELETE' });
                  } catch (error) {
                    console.error(`Failed to delete delegation ${delegation.sessionId}:`, error);
                  }
                  
                  // Remove from UI state
                  setDelegationsMap((prev) => {
                    const { [delegation.sessionId]: _ignored, ...rest } = prev;
                    return rest;
                  });
                  setDelegationMessages((prev) => {
                    const { [delegation.sessionId]: _ignored, ...rest } = prev;
                    return rest;
                  });
                  if (activeAgentTab === delegation.sessionId) {
                    setActiveAgentTab('ra-h');
                  }
                }}
                className="agent-tab-close"
                title="Close tab"
              >
                ×
              </button>
            </div>
          );
        })}
        </div>
      )}

      {/* Active Panel */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {mode === 'quickadd' ? (
          <div style={{ 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <QuickAddStatus
              delegations={orderedDelegations}
              onDelegationClick={handleDelegationClick}
            />
          </div>
        ) : (
          <>
            {/* Keep RAHChat always mounted, just hide when not active */}
            <div style={{ 
              height: '100%', 
              display: activeAgentTab === 'ra-h' ? 'block' : 'none' 
            }}>
                <RAHChat
                  openTabsData={openTabsData}
                  activeTabId={activeTabId}
                  onNodeClick={onNodeClick}
                  delegations={orderedDelegations}
                  messages={rahMessages}
                  setMessages={setRahMessages}
                  mode={rahMode}
                />
            </div>
            
            {/* Show delegation chat when delegation tab is active */}
            {selectedDelegation && activeAgentTab !== 'ra-h' && (
              <div style={{ height: '100%', display: 'block' }}>
                <RAHChat
                  openTabsData={openTabsData}
                  activeTabId={activeTabId}
                  onNodeClick={onNodeClick}
                  delegations={orderedDelegations}
                  messages={getDelegationMessages(selectedDelegation.sessionId)}
                  setMessages={setDelegationMessagesFor(selectedDelegation.sessionId)}
                  mode="easy"
                  delegationMode={true}
                  delegationSessionId={selectedDelegation.sessionId}
                />
              </div>
            )}
          </>
        )}
      </div>
      <style jsx>{`
        .agent-tabs {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px 0 12px;
          background: #101010;
          border-bottom: 1px solid #1a1a1a;
          overflow-x: auto;
          overflow-y: hidden;
          white-space: nowrap;
        }

        .agent-tabs::-webkit-scrollbar {
          height: 6px;
        }

        .agent-tabs::-webkit-scrollbar-track {
          background: #131313;
        }

        .agent-tabs::-webkit-scrollbar-thumb {
          background: #1f1f1f;
          border-radius: 999px;
        }

        .agent-tabs::-webkit-scrollbar-thumb:hover {
          background: #2c2c2c;
        }

        .agent-tab-wrapper {
          display: flex;
          align-items: center;
          background: transparent;
          border-radius: 10px 10px 0 0;
          transition: background 0.15s ease;
        }

        .agent-tab-wrapper.active {
          background: #181818;
        }

        .agent-tab {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 14px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #6f6f6f;
          transition: color 0.15s ease;
        }

        .agent-tab-wrapper.active .agent-tab {
          color: #f3f3f3;
        }

        .agent-tab:hover {
          color: #d0d0d0;
        }

        .agent-tab-wrapper.wise .agent-tab-label {
          color: inherit;
        }

        .agent-tab-wrapper.mini .agent-tab-label {
          color: inherit;
        }

        .agent-tab-close {
          padding: 4px 8px;
          background: transparent;
          border: none;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 14px;
          color: #5a5a5a;
          cursor: pointer;
          transition: color 0.15s ease;
        }

        .agent-tab-close:hover {
          color: #ff6b6b;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
      `}</style>
    </div>
  );
}
