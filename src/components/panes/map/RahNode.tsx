"use client";

import { memo, useCallback, useContext } from 'react';
import { Handle, Position, useStore, type NodeProps, type Node, type ReactFlowState } from '@xyflow/react';
import { groupColorVar, type RahNodeData } from './utils';
import { CompactBelowZoomContext } from './labelZoom';
import { getNodeIcon } from '@/utils/nodeIcons';

type RahNodeType = Node<RahNodeData, 'rahNode'>;

// Label level-of-detail: when zoomed out past the fitted view, less prominent overview
// nodes show only their icon so the hubs' labels stay readable. Hubs always keep labels.
const HUB_PROMINENCE = 0.35;

function RahNodeComponent({ data, selected }: NodeProps<RahNodeType>) {
  const { label, dbNode, role, prominence, group } = data;
  const isSelected = selected || role === 'selected';
  const compactBelowZoom = useContext(CompactBelowZoomContext);
  // Boolean selector: nodes re-render only when the threshold is crossed.
  const zoomedOutSelector = useCallback(
    (state: ReactFlowState) => state.transform[2] < compactBelowZoom,
    [compactBelowZoom],
  );
  const zoomedOut = useStore(zoomedOutSelector);
  const compact = zoomedOut && role === 'overview' && !isSelected && prominence < HUB_PROMINENCE;
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
        compact && 'rah-map-node--compact',
      ].filter(Boolean).join(' ')}
      title={compact ? label : undefined}
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
        <span className="rah-map-node__label">
          {label.length > 26 ? label.slice(0, 24) + '\u2026' : label}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="rah-map-handle rah-map-handle--hidden" isConnectable={false} />
    </div>
  );
}

export const RahNode = memo(RahNodeComponent);
