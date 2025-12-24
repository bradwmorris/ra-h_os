"use client";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
          marginBottom: '24px', 
          lineHeight: 1.6,
          wordWrap: 'break-word',
          overflowWrap: 'break-word'
        }}>
          {message}
        </div>
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
            onClick={onConfirm}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #dc2626',
              background: '#7f1d1d',
              color: '#fca5a5',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#991b1b';
              e.currentTarget.style.borderColor = '#b91c1c';
              e.currentTarget.style.color = '#fecaca';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#7f1d1d';
              e.currentTarget.style.borderColor = '#dc2626';
              e.currentTarget.style.color = '#fca5a5';
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
