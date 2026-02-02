"use client";

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import LogsViewer from './LogsViewer';
import ToolsViewer from './ToolsViewer';
import ApiKeysViewer from './ApiKeysViewer';
import DatabaseViewer from './DatabaseViewer';
import ExternalAgentsPanel from './ExternalAgentsPanel';
import ContextViewer from './ContextViewer';
import GuidesViewer from './GuidesViewer';
import { apiKeyService } from '@/services/storage/apiKeys';

export type SettingsTab =
  | 'logs'
  | 'tools'
  | 'guides'
  | 'apikeys'
  | 'database'
  | 'context'
  | 'agents';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

type TabType = SettingsTab;

export default function SettingsModal({ isOpen, onClose, initialTab }: SettingsModalProps) {
  // Default to API Keys tab if no keys are configured, otherwise logs
  const getDefaultTab = (): TabType => {
    if (typeof window !== 'undefined') {
      const hasKey = apiKeyService.getOpenAiKey();
      return hasKey ? 'logs' : 'apikeys';
    }
    return 'logs';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getDefaultTab());
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !initialTab) return;
    setActiveTab(initialTab);
  }, [initialTab, isOpen]);

  if (!isOpen) return null;

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '80vw',
          height: '85vh',
          background: '#0f0f0f',
          border: '1px solid #2a2a2a',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div
          style={{
            width: '20%',
            background: '#0a0a0a',
            borderRight: '1px solid #2a2a2a',
            display: 'flex',
            flexDirection: 'column',
            padding: '24px 0'
          }}
        >
          <div
            style={{
              padding: '0 24px',
              marginBottom: '24px',
              fontSize: '18px',
              fontWeight: '600',
              color: '#fff'
            }}
          >
            Settings
          </div>
          <nav>
            <div
              onClick={() => setActiveTab('logs')}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: activeTab === 'logs' ? '#fff' : '#888',
                background: activeTab === 'logs' ? '#1a3a2a' : 'transparent',
                borderLeft: activeTab === 'logs' ? '3px solid #22c55e' : '3px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Logs
            </div>
            <div
              onClick={() => setActiveTab('tools')}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: activeTab === 'tools' ? '#fff' : '#888',
                background: activeTab === 'tools' ? '#1a3a2a' : 'transparent',
                borderLeft: activeTab === 'tools' ? '3px solid #22c55e' : '3px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Tools
            </div>
            <div
              onClick={() => setActiveTab('guides')}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: activeTab === 'guides' ? '#fff' : '#888',
                background: activeTab === 'guides' ? '#1a3a2a' : 'transparent',
                borderLeft: activeTab === 'guides' ? '3px solid #22c55e' : '3px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Guides
            </div>
            <div
              onClick={() => setActiveTab('apikeys')}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: activeTab === 'apikeys' ? '#fff' : '#888',
                background: activeTab === 'apikeys' ? '#1a3a2a' : 'transparent',
                borderLeft: activeTab === 'apikeys' ? '3px solid #22c55e' : '3px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              API Keys
            </div>
            <div
              onClick={() => setActiveTab('database')}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: activeTab === 'database' ? '#fff' : '#888',
                background: activeTab === 'database' ? '#1a3a2a' : 'transparent',
                borderLeft: activeTab === 'database' ? '3px solid #22c55e' : '3px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Database
            </div>
            <div
              onClick={() => setActiveTab('context')}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: activeTab === 'context' ? '#fff' : '#888',
                background: activeTab === 'context' ? '#1a3a2a' : 'transparent',
                borderLeft: activeTab === 'context' ? '3px solid #22c55e' : '3px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Context
            </div>
            <div
              onClick={() => setActiveTab('agents')}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: activeTab === 'agents' ? '#fff' : '#888',
                background: activeTab === 'agents' ? '#1a3a2a' : 'transparent',
                borderLeft: activeTab === 'agents' ? '3px solid #22c55e' : '3px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              External Agents
            </div>
            <div
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: '#888',
                opacity: 0.4,
                cursor: 'not-allowed'
              }}
            >
              Backups
            </div>
            <div
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                color: '#888',
                opacity: 0.4,
                cursor: 'not-allowed'
              }}
            >
              Preferences
            </div>
          </nav>

          <div
            style={{
              marginTop: 'auto',
              padding: '24px',
              borderTop: '1px solid #1f2937',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#64748b'
              }}
            >
              Local Mode
            </div>
            <p
              style={{
                fontSize: '13px',
                color: '#94a3b8',
                margin: 0,
                lineHeight: 1.5
              }}
            >
              This open-source build runs entirely on your machine. Add keys via the API Keys tab to unlock every agent.
            </p>
          </div>
        </div>

        {/* Content Area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid #2a2a2a',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: '600',
                color: '#fff'
              }}
            >
              {activeTab === 'logs' && 'System Logs'}
              {activeTab === 'tools' && 'Tools'}
              {activeTab === 'guides' && 'Guides'}
              {activeTab === 'apikeys' && 'API Keys'}
              {activeTab === 'database' && 'Knowledge Database'}
              {activeTab === 'context' && 'Auto-Context'}
              {activeTab === 'agents' && 'External Agents'}
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                fontSize: '24px',
                lineHeight: 1,
                padding: '4px 8px',
                transition: 'color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#888';
              }}
              title="Close (ESC)"
            >
              ×
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeTab === 'logs' && <LogsViewer key={isOpen ? 'open' : 'closed'} />}
            {activeTab === 'tools' && <ToolsViewer />}
            {activeTab === 'guides' && <GuidesViewer />}
            {activeTab === 'apikeys' && <ApiKeysViewer />}
            {activeTab === 'database' && <DatabaseViewer />}
            {activeTab === 'context' && <ContextViewer />}
            {activeTab === 'agents' && <ExternalAgentsPanel />}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
