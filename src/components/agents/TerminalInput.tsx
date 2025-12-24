"use client";

import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff } from 'lucide-react';

interface TerminalInputProps {
  onSubmit: (text: string) => void;
  isProcessing: boolean;
  placeholder?: string;
  helperId?: number;
  disabledExternally?: boolean;
  disabledMessage?: string;
  onVoiceToggle?: () => void;
  isVoiceActive?: boolean;
  voiceAmplitude?: number;
  voiceError?: string | null;
}

export default function TerminalInput({
  onSubmit,
  isProcessing,
  placeholder,
  helperId,
  disabledExternally = false,
  disabledMessage,
  onVoiceToggle,
  isVoiceActive = false,
  voiceAmplitude = 0,
  voiceError,
}: TerminalInputProps) {
  const [input, setInput] = useState('');
  const [rows, setRows] = useState(1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompts, setPrompts] = useState<Array<{ id: string; name: string; content: string }>>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const load = async () => {
      if (!helperId) return;
      try {
        const resp = await fetch(`/api/helpers/${helperId}/prompts`);
        const data = await resp.json();
        if (resp.ok && data.success) setPrompts(Array.isArray(data.data?.prompts) ? data.data.prompts : []);
      } catch (e) {
        console.error('Failed to load prompts:', e);
      }
    };
    load();
  }, [helperId]);

  // Auto-resize textarea - only resize when needed to avoid jumps
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const lineHeight = 24; // line-height * font-size approximately
    const minHeight = 32;
    const maxHeight = 120;
    
    // Check if content overflows current height (need to grow)
    const needsGrow = textarea.scrollHeight > textarea.clientHeight;
    
    // Check if we cleared content significantly (need to shrink)
    const lineCount = (input.match(/\n/g) || []).length + 1;
    const estimatedHeight = Math.max(lineCount * lineHeight, minHeight);
    const needsShrink = !input.trim() || (textarea.clientHeight > estimatedHeight + lineHeight);
    
    if (needsGrow || needsShrink) {
      // Only recalculate when necessary
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
      textarea.style.height = `${newHeight}px`;
      
      const newRows = Math.min(Math.max(1, Math.floor(newHeight / lineHeight)), 5);
      setRows(newRows);
    }
  }, [input]);

  const handleSubmit = () => {
    if (input.trim() && !isProcessing && !disabledExternally) {
      // Numeric slash expansion: only when input is exactly /N
      const m = input.trim().match(/^\/(\d{1,2})$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const idx = n - 1;
        if (!isNaN(idx) && idx >= 0 && idx < prompts.length) {
          const content = String(prompts[idx]?.content || '').trim();
          if (content) {
            onSubmit(content);
            setInput('');
            setRows(1);
            setShowSlashMenu(false);
            return;
          }
        }
      }
      onSubmit(input.trim());
      setInput('');
      setRows(1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash menu navigation
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, prompts.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab') { e.preventDefault(); setActiveIndex(i => (i + 1) % Math.max(prompts.length, 1)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const p = prompts[activeIndex];
        if (p) { setInput(p.content); setShowSlashMenu(false); }
        return;
      }
      if (e.key === 'Escape') { setShowSlashMenu(false); }
    }
    if (e.key === 'Enter' && !e.shiftKey && !disabledExternally) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    // Toggle slash menu when typing starting '/'
    const trimmed = input.trimStart();
    if (trimmed.startsWith('/')) {
      setShowSlashMenu(true);
      setActiveIndex(0);
    } else {
      setShowSlashMenu(false);
    }
  }, [input]);

  const trimmedInput = input.trim();
  const showVoiceStart = !isVoiceActive && !trimmedInput && Boolean(onVoiceToggle);
  const showVoiceStop = Boolean(onVoiceToggle) && isVoiceActive;
  const buttonIsDisabled =
    showVoiceStart || showVoiceStop
      ? false
      : (!trimmedInput || isProcessing || disabledExternally);

  const handlePrimaryAction = () => {
    if (showVoiceStart || showVoiceStop) {
      onVoiceToggle?.();
      return;
    }
    handleSubmit();
  };

  const amplitudeBars = Array.from({ length: 8 });

  
  return (
    <>
    <style>{`
      @keyframes subtle-pulse {
        0%, 100% { opacity: 0.5; color: #3a3a3a; }
        50% { opacity: 0.7; color: #22c55e; }
      }
      textarea::placeholder {
        animation: subtle-pulse 4s ease-in-out infinite;
      }
    `}</style>
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      padding: '8px 16px 12px',
      background: 'transparent',
      // Remove separator/border between chat area and input
      borderTop: 'none',
      fontFamily: 'inherit'
    }}>
      {/* Terminal Prompt Symbol */}
      <span style={{
        color: '#4a4a4a',
        fontSize: '13px',
        lineHeight: '1.5',
        paddingTop: '6px',
        userSelect: 'none',
        fontWeight: 500
      }}>
        {'>'}
      </span>

      {/* Input Wrapper */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
      {isVoiceActive && (
        <div style={{
          border: 'none',
          borderRadius: '0',
          background: 'transparent',
          padding: '12px 4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: '12px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#d4d4d4',
            }}>
              RA-H is listening
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, minmax(0, 1fr))', gap: '3px', height: '20px', marginTop: '6px' }}>
            {amplitudeBars.map((_, index) => {
              const level = (index + 1) / amplitudeBars.length;
              const active = voiceAmplitude >= level - 0.0001;
              return (
                <div
                  key={`amp-${index}`}
                  style={{
                    width: '100%',
                    borderRadius: '2px',
                    height: `${10 + index * 1.2}px`,
                    background: active ? '#22c55e' : '#1f1f1f',
                    transition: 'background 120ms ease',
                  }}
                />
              );
            })}
          </div>
          {voiceError && (
            <span style={{ color: '#f87171', fontSize: '11px' }}>{voiceError}</span>
          )}
        </div>
      )}
      {/* Input Row with Textarea and Button */}
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start',
          position: 'relative'
        }}>
        <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing || disabledExternally}
            placeholder={placeholder || `ask ra-h...`}
            rows={rows}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              borderRadius: '0',
              color: '#e5e5e5',
              fontSize: '16px',
              fontFamily: 'inherit',
              padding: '8px 4px',
              resize: 'none',
              outline: 'none',
              lineHeight: '1.5',
              transition: 'all 200ms ease',
              minHeight: '32px',
              maxHeight: '120px',
              overflowY: 'auto',
              overflowX: 'hidden',
              caretColor: '#22c55e',
              ...((isProcessing || disabledExternally) && {
                opacity: 0.5,
                cursor: 'not-allowed',
                caretColor: 'transparent'
              })
            }}
            // No focus border toggling; keep clean
            onFocus={() => {}}
            onBlur={() => {}}
          />

          {/* Slash menu */}
          {showSlashMenu && prompts.length > 0 && (
            <div style={{ position: 'absolute', bottom: '48px', left: '40px', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '6px', minWidth: '260px', maxHeight: '200px', overflowY: 'auto', zIndex: 1000 }}>
              {prompts.map((p, i) => (
                <div
                  key={p.id}
                  onMouseDown={(e) => { e.preventDefault(); setInput(p.content); setShowSlashMenu(false); }}
                  onMouseEnter={() => setActiveIndex(i)}
                  style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 8px', cursor: 'pointer', background: i === activeIndex ? '#1a1a1a' : 'transparent', color: '#cfcfcf', fontSize: '12px' }}
                >
            <span style={{ color: '#5c9aff', fontSize: '10px', width: '20px' }}>/ {i + 1}</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
          </div>
              ))}
            </div>
          )}
          
          {/* Submit Button (minimal icon) */}
          <button
            onClick={handlePrimaryAction}
            disabled={buttonIsDisabled}
            aria-label={
              showVoiceStop
                ? 'Stop voice session'
                : showVoiceStart
                  ? 'Start voice session'
                  : isProcessing
                    ? 'Processing'
                    : 'Send message'
            }
            title={
              showVoiceStop
                ? 'Stop voice session'
                : showVoiceStart
                  ? 'Start voice session'
                  : disabledExternally
                    ? (disabledMessage || 'Voice mode active')
                    : isProcessing
                      ? 'Processing…'
                      : 'Send (Enter)'
            }
            style={{
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            background: '#22c55e',
            border: '2px solid #22c55e',
              borderRadius: '50%',
              color: '#0a0a0a',
              cursor: buttonIsDisabled ? 'not-allowed' : 'pointer',
              transition: 'all 150ms ease',
              opacity: buttonIsDisabled ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!buttonIsDisabled) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = `0 4px 12px rgba(${showVoiceStart || showVoiceStop ? '124,58,237' : '34,197,94'}, 0.4)`;
              }
            }}
            onMouseLeave={(e) => {
              if (!buttonIsDisabled) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
          >
            {showVoiceStop ? (
              <MicOff size={16} strokeWidth={2.4} color="#0a0a0a" />
            ) : showVoiceStart ? (
              <Mic size={16} strokeWidth={2.4} color="#0a0a0a" />
            ) : isProcessing ? (
              <span style={{ fontSize: '12px' }}>•••</span>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path d="M12 4l-6.5 6.5 1.42 1.42L11 8.84V20h2V8.84l4.08 3.08 1.42-1.42L12 4z" />
              </svg>
            )}
          </button>
        </div>

        {/* Subtle Keyboard Hints */}
        <div style={{
          display: 'flex',
          gap: '10px',
          fontSize: '10px',
          color: '#353535',
          userSelect: 'none',
          marginTop: '2px'
        }}>
          <span>⏎ send</span>
          <span>⇧⏎ newline</span>
          {(isProcessing || disabledExternally) && (
            <span style={{ 
              marginLeft: 'auto',
              color: disabledExternally ? '#a855f7' : '#ffcc66',
              textTransform: 'uppercase',
              letterSpacing: '0.12em'
            }}>
              {disabledExternally ? (disabledMessage || 'voice mode active') : 'processing...'}
            </span>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
