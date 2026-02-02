"use client";

import { useState, useEffect, type CSSProperties } from 'react';
import { apiKeyService, ApiKeyStatus } from '@/services/storage/apiKeys';

export default function ApiKeysViewer() {
  const [openaiKey, setOpenaiKey] = useState('');
  const [status, setStatus] = useState<ApiKeyStatus>({ openai: 'not-set' });
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (apiKeyService.hasOpenAiKey()) {
      setOpenaiKey(apiKeyService.getMaskedOpenAiKey());
    }
    setStatus(apiKeyService.getStatus());
  }, []);

  const handleSave = async () => {
    if (!openaiKey.trim() || openaiKey.includes('•')) return;
    try {
      apiKeyService.setOpenAiKey(openaiKey.trim());
      setStatus({ openai: 'testing' });
      const ok = await apiKeyService.testOpenAiConnection();
      setStatus({ openai: ok ? 'connected' : 'failed' });
      if (ok) {
        setOpenaiKey(apiKeyService.getMaskedOpenAiKey());
      }
    } catch (error) {
      setStatus({ openai: 'failed' });
    }
  };

  const handleClear = () => {
    apiKeyService.clearOpenAiKey();
    setOpenaiKey('');
    setStatus({ openai: 'not-set' });
  };

  const getStatusLabel = (s: string) => {
    if (s === 'connected') return { text: 'Connected', color: '#22c55e' };
    if (s === 'failed') return { text: 'Failed', color: '#ef4444' };
    if (s === 'testing') return { text: 'Testing...', color: '#6b7280' };
    return { text: 'Not configured', color: '#6b7280' };
  };

  const statusInfo = getStatusLabel(status.openai);

  return (
    <div style={containerStyle}>
      {/* Features explanation */}
      <div style={featuresBoxStyle}>
        <div style={featuresHeaderStyle}>OpenAI API Key enables:</div>
        <ul style={featuresListStyle}>
          <li>Auto-generated descriptions for new nodes</li>
          <li>Smart dimension assignment</li>
          <li>Semantic search via embeddings</li>
        </ul>
        <div style={noteStyle}>
          Without a key, you can still create and organize nodes manually.
        </div>
      </div>

      {/* Key input */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <span style={cardTitleStyle}>OpenAI API Key</span>
          <span style={{ fontSize: 12, color: statusInfo.color }}>
            {statusInfo.text}
          </span>
        </div>

        <input
          type={showKey ? 'text' : 'password'}
          value={openaiKey}
          onChange={(e) => setOpenaiKey(e.target.value)}
          placeholder="sk-..."
          style={inputStyle}
        />

        <div style={buttonRowStyle}>
          <button
            onClick={handleSave}
            disabled={!openaiKey.trim() || openaiKey.includes('•')}
            style={{
              ...btnPrimaryStyle,
              opacity: openaiKey.trim() && !openaiKey.includes('•') ? 1 : 0.4,
            }}
          >
            Save & Test
          </button>
          <button
            onClick={handleClear}
            disabled={status.openai === 'not-set'}
            style={{
              ...btnSecondaryStyle,
              opacity: status.openai !== 'not-set' ? 1 : 0.4,
            }}
          >
            Clear
          </button>
          <label style={toggleStyle}>
            <input
              type="checkbox"
              checked={showKey}
              onChange={(e) => setShowKey(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Show
          </label>
        </div>
      </div>

      {/* Get key link */}
      <div style={helpStyle}>
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noreferrer"
          style={linkStyle}
        >
          Get your API key from OpenAI →
        </a>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  padding: 24,
  height: '100%',
  overflow: 'auto',
};

const featuresBoxStyle: CSSProperties = {
  background: 'rgba(34, 197, 94, 0.08)',
  border: '1px solid rgba(34, 197, 94, 0.2)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 20,
};

const featuresHeaderStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#22c55e',
  marginBottom: 8,
};

const featuresListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  fontSize: 13,
  color: '#d1d5db',
  lineHeight: 1.6,
};

const noteStyle: CSSProperties = {
  marginTop: 12,
  fontSize: 12,
  color: '#6b7280',
  fontStyle: 'italic',
};

const cardStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
};

const cardTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#e5e7eb',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'monospace',
  background: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 6,
  color: '#e5e7eb',
  marginBottom: 12,
  outline: 'none',
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

const btnPrimaryStyle: CSSProperties = {
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 500,
  background: '#22c55e',
  color: '#052e16',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const btnSecondaryStyle: CSSProperties = {
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 500,
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#9ca3af',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const toggleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: 12,
  color: '#6b7280',
  cursor: 'pointer',
  marginLeft: 'auto',
};

const helpStyle: CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
};

const linkStyle: CSSProperties = {
  color: '#22c55e',
  textDecoration: 'none',
};
