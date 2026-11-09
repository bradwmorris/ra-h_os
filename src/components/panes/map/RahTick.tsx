"use client";

import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';

export interface RahTickData {
  label: string;
  /** Length of the guide line below the label, in flow units. */
  lineHeight: number;
  [key: string]: unknown;
}

type RahTickType = Node<RahTickData, 'rahTick'>;

/** A date marker on the timeline: a label with a faint guide line running down the lanes. */
function RahTickComponent({ data }: NodeProps<RahTickType>) {
  return (
    <div className="rah-map-tick">
      <span className="rah-map-tick__label">{data.label}</span>
      <span className="rah-map-tick__line" style={{ height: data.lineHeight }} />
    </div>
  );
}

export const RahTick = memo(RahTickComponent);
