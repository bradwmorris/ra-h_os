"use client";

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentDelegation } from '@/services/agents/delegation';

type QuickAddIntent = 'link' | 'note' | 'chat';

interface QuickAddSubmitPayload {
  input: string;
  mode: QuickAddIntent;
}

interface QuickAddInputProps {
  activeDelegations: AgentDelegation[];
  onSubmit: (payload: QuickAddSubmitPayload) => Promise<void>;
}

const MODE_CONFIG: Array<{
  key: QuickAddIntent;
  label: string;
  hint: string;
  icon: ReactNode;
}> = [
  {
    key: 'link',
    label: 'Link',
    hint: 'Drop URLs for auto extraction',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.35l2.12-2.12a5 5 0 1 0-7.07-7.07l-1.29 1.29" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 11a5 5 0 0 0-7.54-.35l-2.12 2.12a5 5 0 1 0 7.07 7.07l1.29-1.29" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    key: 'note',
    label: 'Note',
    hint: 'Quick note, no processing',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 13H8" strokeLinecap="round" />
        <path d="M16 17H8" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'chat',
    label: 'Chat',
    hint: 'Paste conversations',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H9l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
];

export default function QuickAddInput({ activeDelegations, onSubmit }: QuickAddInputProps) {
  const [input, setInput] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [manualMode, setManualMode] = useState<QuickAddIntent | null>(null);
  const [autoMode, setAutoMode] = useState<QuickAddIntent>('link');

  const effectiveMode: QuickAddIntent = manualMode ?? autoMode;

  const currentPlaceholder = useMemo(() => {
    if (effectiveMode === 'note') return 'Write a quick note...';
    if (effectiveMode === 'chat') return 'Paste conversation...';
    return 'Paste a link or write something...';
  }, [effectiveMode]);

  const maxConcurrent = 5;
  const activeCount = activeDelegations.filter(
    (d) => d.status === 'queued' || d.status === 'in_progress'
  ).length;
  const isSoftLimited = activeCount >= maxConcurrent;

  const inferChatIntent = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || manualMode) return;

    const newlineCount = (trimmed.match(/\n/g)?.length ?? 0);
    const looksLikeTranscript =
      newlineCount >= 2 ||
      /You said:|ChatGPT said:|Claude said:|Assistant:|User:/i.test(trimmed);

    if (looksLikeTranscript && trimmed.length > 280) {
      setAutoMode('chat');
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    inferChatIntent(value);
  };

  const handleModeClick = (mode: QuickAddIntent) => {
    setManualMode(mode);
    setAutoMode(mode);
  };

  const handleSubmit = async () => {
    if (!input.trim() || isPosting || isSoftLimited) return;

    setIsPosting(true);
    try {
      await onSubmit({ input: input.trim(), mode: effectiveMode });
      setInput('');
      setManualMode(null);
      setAutoMode('link');
      setIsExpanded(false);
    } catch (error) {
      console.error('[QuickAddInput] Submit error:', error);
    } finally {
      setIsPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setIsExpanded(false);
      setInput('');
    }
  };

  // Collapsed state - visible trigger
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          width: '100%',
          padding: '16px 24px',
          background: 'transparent',
          border: '1px solid #333',
          borderRadius: '12px',
          color: '#888',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          transition: 'all 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = '#444';
          e.currentTarget.style.color = '#aaa';
          e.currentTarget.style.background = '#1a1a1a';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = '#333';
          e.currentTarget.style.color = '#888';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: '#22c55e',
          color: '#0a0a0a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          fontWeight: 700
        }}>+</span>
        CAPTURE
      </button>
    );
  }

  // Expanded state
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      width: '100%',
      background: 'transparent',
      padding: '0',
      animation: 'fadeIn 150ms ease-out'
    }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {MODE_CONFIG.map((mode) => {
          const isActive = effectiveMode === mode.key;
          return (
            <button
              key={mode.key}
              type="button"
              onClick={() => handleModeClick(mode.key)}
              title={mode.hint}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: isActive ? '1px solid #333' : '1px solid transparent',
                background: isActive ? '#1a1a1a' : 'transparent',
                color: isActive ? '#fff' : '#666',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = '#999';
                  e.currentTarget.style.background = '#1a1a1a';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = '#666';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{ display: 'flex', opacity: isActive ? 1 : 0.7 }}>{mode.icon}</span>
              {mode.label}
            </button>
          );
        })}
        
        {/* Close button */}
        <button
          onClick={() => {
            setIsExpanded(false);
            setInput('');
          }}
          style={{
            marginLeft: 'auto',
            padding: '8px',
            background: 'transparent',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#999'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Input area - consistent height */}
      <div style={{ position: 'relative' }}>
        <textarea
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentPlaceholder}
          disabled={isPosting || isSoftLimited}
          autoFocus
          style={{
            width: '100%',
            minHeight: '80px',
            maxHeight: '200px',
            padding: '12px 14px',
            background: '#0a0a0a',
            border: '1px solid #1f1f1f',
            borderRadius: '8px',
            color: '#e5e5e5',
            fontSize: '14px',
            fontFamily: 'inherit',
            outline: 'none',
            resize: 'none',
            transition: 'border-color 0.15s ease'
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#333';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#1f1f1f';
          }}
        />
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', color: '#525252' }}>
          ⌘↵ to submit · esc to close
        </span>
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isPosting || isSoftLimited}
          style={{
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
            background: input.trim() && !isPosting ? '#22c55e' : '#262626',
            border: 'none',
            borderRadius: '50%',
            cursor: input.trim() && !isPosting ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease',
            boxShadow: input.trim() && !isPosting ? '0 0 0 0 rgba(34, 197, 94, 0)' : 'none'
          }}
          onMouseEnter={(e) => {
            if (input.trim() && !isPosting) {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(34, 197, 94, 0.3)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 0 0 0 rgba(34, 197, 94, 0)';
          }}
        >
          {isPosting ? (
            <span style={{ 
              width: '14px', 
              height: '14px', 
              border: '2px solid #0a0a0a',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite'
            }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? '#0a0a0a' : '#525252'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5"/>
              <path d="M5 12l7-7 7 7"/>
            </svg>
          )}
        </button>
      </div>

      {/* Active processing indicator */}
      {activeCount > 0 && (
        <div style={{
          padding: '10px 12px',
          background: '#0a1a0a',
          border: '1px solid #1a3a1a',
          borderRadius: '8px',
          color: '#22c55e',
          fontSize: '11px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#22c55e',
            animation: 'pulse 2s ease-in-out infinite'
          }} />
          Adding {activeCount} node{activeCount > 1 ? 's' : ''}...
        </div>
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
