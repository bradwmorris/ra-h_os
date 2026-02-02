"use client";

import { useState, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { apiKeyService } from '@/services/storage/apiKeys';

export default function FirstRunModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    // Check if this is first run
    if (apiKeyService.isFirstRun()) {
      setIsOpen(true);
    }
  }, []);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;

    setStatus('testing');
    setErrorMessage('');

    try {
      apiKeyService.setOpenAiKey(apiKey.trim());
      const ok = await apiKeyService.testOpenAiConnection();

      if (ok) {
        setStatus('success');
        setTimeout(() => {
          apiKeyService.markFirstRunComplete();
          setIsOpen(false);
        }, 1000);
      } else {
        setStatus('error');
        setErrorMessage('Could not connect to OpenAI. Please check your key.');
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage('Invalid API key format. Keys start with sk-');
    }
  };

  const handleSkip = () => {
    apiKeyService.markFirstRunComplete();
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return createPortal(
    <div style={overlayStyle}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Content */}
        <div style={contentStyle}>
          <div style={sectionStyle}>
            <p style={sectionDescStyle}>
              To use automated features (embeddings, auto-organise, smart descriptions),
              you'll need an OpenAI API key.
            </p>
            <p style={costNoteStyle}>
              Average cost for heavy use is less than $0.10 per day.
            </p>
          </div>

          <div style={inputSectionStyle}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              style={inputStyle}
              autoFocus
            />
            {errorMessage && <div style={errorStyle}>{errorMessage}</div>}
            {status === 'success' && (
              <div style={successStyle}>Connected successfully!</div>
            )}
          </div>

          <div style={buttonSectionStyle}>
            <button
              onClick={handleSaveKey}
              disabled={!apiKey.trim() || status === 'testing'}
              style={{
                ...primaryButtonStyle,
                opacity: apiKey.trim() && status !== 'testing' ? 1 : 0.5,
              }}
            >
              {status === 'testing' ? 'Testing...' : 'Save & Continue'}
            </button>

            <button onClick={handleSkip} style={skipButtonStyle}>
              Skip for now
            </button>
          </div>

          <div style={noteStyle}>
            <p>
              You can add or change your key later in Settings → API Keys.
            </p>
            <p style={{ marginTop: 8 }}>
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                Get an API key from OpenAI →
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.85)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalStyle: CSSProperties = {
  background: '#141414',
  border: '1px solid #262626',
  borderRadius: 16,
  width: '100%',
  maxWidth: 440,
  padding: 32,
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
};

const contentStyle: CSSProperties = {};

const sectionStyle: CSSProperties = {
  marginBottom: 20,
};

const sectionDescStyle: CSSProperties = {
  fontSize: 14,
  color: '#d1d5db',
  marginBottom: 12,
  lineHeight: 1.5,
};

const costNoteStyle: CSSProperties = {
  fontSize: 13,
  color: '#6b7280',
};

const inputSectionStyle: CSSProperties = {
  marginBottom: 20,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  fontSize: 14,
  fontFamily: 'monospace',
  background: 'rgba(0, 0, 0, 0.4)',
  border: '1px solid #333',
  borderRadius: 8,
  color: '#fff',
  outline: 'none',
};

const errorStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: '#ef4444',
};

const successStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: '#22c55e',
};

const buttonSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginBottom: 20,
};

const primaryButtonStyle: CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  fontSize: 14,
  fontWeight: 500,
  background: '#22c55e',
  color: '#052e16',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

const skipButtonStyle: CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  fontSize: 14,
  fontWeight: 500,
  background: 'transparent',
  color: '#6b7280',
  border: '1px solid #333',
  borderRadius: 8,
  cursor: 'pointer',
};

const noteStyle: CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  textAlign: 'center',
};

const linkStyle: CSSProperties = {
  color: '#22c55e',
  textDecoration: 'none',
};
