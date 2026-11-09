"use client";

import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional icon shown before the label. */
  icon?: ReactNode;
  /** Tooltip / longer description. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Map layout". */
  ariaLabel: string;
  /** Hide labels and show icons only (labels stay as accessible names). */
  iconOnly?: boolean;
}

/**
 * A row of mutually exclusive options (radio group) styled as joined buttons.
 * Arrow keys move the selection, like a native radio group.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  iconOnly = false,
}: SegmentedControlProps<T>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = options.findIndex((option) => option.value === value);
    const next = (current + step + options.length) % options.length;
    onChange(options[next].value);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} style={groupStyle} onKeyDown={handleKeyDown}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => { buttonRefs.current[index] = element; }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconOnly ? option.label : undefined}
            tabIndex={selected ? 0 : -1}
            title={option.title ?? option.label}
            onClick={() => onChange(option.value)}
            style={selected ? selectedButtonStyle : buttonStyle}
          >
            {option.icon}
            {iconOnly ? null : <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

const groupStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 8,
  border: '1px solid var(--rah-border-strong)',
  background: 'var(--rah-bg-panel)',
};

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--rah-text-muted)',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const selectedButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--rah-accent-green-soft)',
  color: 'var(--rah-accent-green)',
  fontWeight: 600,
};
