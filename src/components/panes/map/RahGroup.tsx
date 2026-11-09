"use client";

import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { UNLINKED } from './communities';
import { groupColorVar, type RahGroupData } from './utils';

type RahGroupType = Node<RahGroupData, 'rahGroup'>;

/** Soft outline hugging a community of nodes, labelled with its hub at every zoom level. */
function RahGroupComponent({ data, width, height }: NodeProps<RahGroupType>) {
  const color = groupColorVar(data.index);
  const label = data.label.length > 40 ? `${data.label.slice(0, 38)}…` : data.label;

  return (
    <div
      className={['rah-map-group', data.index === UNLINKED && 'rah-map-group--unlinked'].filter(Boolean).join(' ')}
      style={{ width, height, ['--rah-map-group-color' as string]: color }}
    >
      <svg className="rah-map-group__shape" width={width} height={height} aria-hidden="true">
        <path d={data.path} />
      </svg>
      <span className="rah-map-group__label">
        {label}
        <span className="rah-map-group__count">{data.memberCount}</span>
      </span>
    </div>
  );
}

export const RahGroup = memo(RahGroupComponent);
