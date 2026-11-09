"use client";

import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { UNLINKED } from './communities';
import type { RahGroupData } from './utils';

type RahGroupType = Node<RahGroupData, 'rahGroup'>;

export const GROUP_PALETTE_SIZE = 8;

/** CSS custom property holding a group's colour (see map-styles.css). */
export function groupColorVar(index: number): string {
  return index === UNLINKED
    ? 'var(--rah-map-group-unlinked)'
    : `var(--rah-map-group-${index % GROUP_PALETTE_SIZE})`;
}

/** Soft background halo behind a community of nodes, labelled with its hub. */
function RahGroupComponent({ data, width, height }: NodeProps<RahGroupType>) {
  const color = groupColorVar(data.index);
  const label = data.label.length > 40 ? `${data.label.slice(0, 38)}…` : data.label;

  return (
    <div
      className={['rah-map-group', data.index === UNLINKED && 'rah-map-group--unlinked'].filter(Boolean).join(' ')}
      style={{ width, height, ['--rah-map-group-color' as string]: color }}
    >
      <span className="rah-map-group__label">
        {label}
        <span className="rah-map-group__count">{data.memberCount}</span>
      </span>
    </div>
  );
}

export const RahGroup = memo(RahGroupComponent);
