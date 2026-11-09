"use client";

import { memo } from 'react';
import { useStore, type NodeProps, type Node, type ReactFlowState } from '@xyflow/react';
import { UNLINKED } from './communities';
import type { RahGroupData } from './utils';

type RahGroupType = Node<RahGroupData, 'rahGroup'>;

export const GROUP_PALETTE_SIZE = 8;

// Group labels are for the zoomed-out overview; they fade out as node labels become
// readable (semantic zoom).
const LABEL_FADE_START_ZOOM = 0.7;
const LABEL_FADE_END_ZOOM = 1.1;

/** CSS custom property holding a group's colour (see map-styles.css). */
export function groupColorVar(index: number): string {
  return index === UNLINKED
    ? 'var(--rah-map-group-unlinked)'
    : `var(--rah-map-group-${index % GROUP_PALETTE_SIZE})`;
}

// Quantised so groups only re-render when the opacity step changes, not on every zoom tick.
const labelOpacitySelector = (state: ReactFlowState) => {
  const zoom = state.transform[2];
  const t = (zoom - LABEL_FADE_START_ZOOM) / (LABEL_FADE_END_ZOOM - LABEL_FADE_START_ZOOM);
  return Math.round(Math.min(1, Math.max(0, 1 - t)) * 10) / 10;
};

/** Soft outline hugging a community of nodes, labelled with its hub when zoomed out. */
function RahGroupComponent({ data, width, height }: NodeProps<RahGroupType>) {
  const color = groupColorVar(data.index);
  const labelOpacity = useStore(labelOpacitySelector);
  const label = data.label.length > 40 ? `${data.label.slice(0, 38)}…` : data.label;

  return (
    <div
      className={['rah-map-group', data.index === UNLINKED && 'rah-map-group--unlinked'].filter(Boolean).join(' ')}
      style={{ width, height, ['--rah-map-group-color' as string]: color }}
    >
      <svg className="rah-map-group__shape" width={width} height={height} aria-hidden="true">
        <path d={data.path} />
      </svg>
      {labelOpacity > 0 ? (
        <span className="rah-map-group__label" style={{ opacity: labelOpacity }}>
          {label}
          <span className="rah-map-group__count">{data.memberCount}</span>
        </span>
      ) : null}
    </div>
  );
}

export const RahGroup = memo(RahGroupComponent);
