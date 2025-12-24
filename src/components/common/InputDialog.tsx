"use client";

import { useState, useEffect, useRef } from 'react';

interface InputDialogProps {
  open: boolean;
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function InputDialog({
  open,
  title,
  message,
  placeholder = '',
  defaultValue = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [inputValue, setInputValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInputValue(defaultValue);
      // Focus input when dialog opens
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [open, defaultValue]);

  const handleConfirm = () => {
    if (inputValue.trim()) {
      onConfirm(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="modal-content"
        style={{
          width: '380px',
          maxWidth: '100%',
          background: '#121212',
          border: '1px solid #2a2a2a',
          borderRadius: '8px',
          padding: '24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)'
        }}
      >
        <div style={{ 
          fontSize: '15px', 
          fontWeight: 600, 
          color: '#e5e5e5', 
          marginBottom: '12px',
          letterSpacing: '0.01em',
          fontFamily: "'Geist', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        }}>
          {title}
        </div>
        <div style={{ 
          fontSize: '13px', 
          color: '#a8a8a8', 
          marginBottom: '16px', 
          lineHeight: 1.6,
          wordWrap: 'break-word',
          overflowWrap: 'break-word'
        }}>
          {message}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: '#0a0a0a',
            border: '1px solid #2a2a2a',
            borderRadius: '6px',
            color: '#e5e5e5',
            fontSize: '13px',
            marginBottom: '24px',
            outline: 'none',
            transition: 'border-color 0.2s',
            fontFamily: "'Geist', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          }}
          onFocus={(e) => {
            e.target.style.borderColor = '#3a3a3a';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = '#2a2a2a';
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #1f1f1f',
              background: 'transparent',
              color: '#94a3b8',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#0f0f0f';
              e.currentTarget.style.borderColor = '#2a2a2a';
              e.currentTarget.style.color = '#cbd5f5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = '#1f1f1f';
              e.currentTarget.style.color = '#94a3b8';
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!inputValue.trim()}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #22c55e',
              background: inputValue.trim() ? '#1a3529' : '#0f1a15',
              color: inputValue.trim() ? '#7de8a5' : '#4a5a4f',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontSize: '11px',
              fontWeight: 500,
              cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              if (inputValue.trim()) {
                e.currentTarget.style.background = '#1f3d2f';
                e.currentTarget.style.borderColor = '#2dd47e';
                e.currentTarget.style.color = '#9ef5b8';
              }
            }}
            onMouseLeave={(e) => {
              if (inputValue.trim()) {
                e.currentTarget.style.background = '#1a3529';
                e.currentTarget.style.borderColor = '#22c55e';
                e.currentTarget.style.color = '#7de8a5';
              }
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

