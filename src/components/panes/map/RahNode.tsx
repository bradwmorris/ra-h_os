"use client";

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { RahNodeData } from './utils';
import { groupColorVar } from './RahGroup';
import { getNodeIcon } from '@/utils/nodeIcons';

type RahNodeType = Node<RahNodeData, 'rahNode'>;

function RahNodeComponent({ data, selected }: NodeProps<RahNodeType>) {
  const { label, dbNode, role, prominence, group } = data;
  const isSelected = selected || role === 'selected';
  const sizeScale = role === 'selected'
    ? 1.08
    : role === 'first-hop'
      ? 1.02 + prominence * 0.06
      : 0.92 + prominence * 0.12;
  const strongNode = prominence > 0.72 && role === 'overview';

  return (
    <div
      className={[
        'rah-map-node',
        role === 'selected' && 'rah-map-node--selected',
        role === 'first-hop' && 'rah-map-node--first-hop',
        role === 'second-hop' && 'rah-map-node--second-hop',
        role === 'overview' && 'rah-map-node--overview',
        isSelected && 'rah-map-node--active',
        strongNode && 'rah-map-node--strong',
        group !== null && 'rah-map-node--grouped',
      ].filter(Boolean).join(' ')}
      style={{
        transform: `scale(${sizeScale})`,
        ...(group !== null ? { ['--rah-map-group-color' as string]: groupColorVar(group) } : {}),
      }}
    >
      <Handle type="target" position={Position.Top} className="rah-map-handle rah-map-handle--hidden" isConnectable={false} />
      <div className="rah-map-node__title">
        <span className="rah-map-node__icon">
          {getNodeIcon(dbNode, 14)}
        </span>
        {label.length > 26 ? label.slice(0, 24) + '\u2026' : label}
      </div>
      <Handle type="source" position={Position.Bottom} className="rah-map-handle rah-map-handle--hidden" isConnectable={false} />
    </div>
  );
}

export const RahNode = memo(RahNodeComponent);
