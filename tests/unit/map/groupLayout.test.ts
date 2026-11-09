import { describe, expect, it } from 'vitest';
import type { Node as DbNode } from '@/types/database';
import { UNLINKED } from '@/components/panes/map/communities';
import {
  groupHaloBounds,
  toRFNodes,
  withUngroupedAsUnlinked,
  type MapGroup,
} from '@/components/panes/map/utils';

function dbNode(id: number): DbNode {
  return { id, title: `Node ${id}`, edge_count: 0 } as unknown as DbNode;
}

function insideEllipse(point: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }): boolean {
  const rx = box.width / 2;
  const ry = box.height / 2;
  const dx = (point.x - (box.x + rx)) / rx;
  const dy = (point.y - (box.y + ry)) / ry;
  return dx * dx + dy * dy <= 1 + 1e-9;
}

describe('groupHaloBounds', () => {
  it('returns null for an empty group', () => {
    expect(groupHaloBounds([])).toBeNull();
  });

  it('contains every node centre and hugs a round cluster more tightly than a circumscribed box', () => {
    const rects = Array.from({ length: 12 }, (_v, i) => {
      const angle = (i / 12) * Math.PI * 2;
      return { x: Math.cos(angle) * 200 - 60, y: Math.sin(angle) * 100 - 16, width: 120, height: 32 };
    });
    const box = groupHaloBounds(rects, 0)!;

    rects.forEach((rect) => {
      expect(insideEllipse({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, box)).toBe(true);
    });
    // Circumscribing the centres' bounding box would need width 400 * sqrt(2) + 120 ~ 686.
    expect(box.width).toBeLessThan(560);
  });

  it('gives a single node a small halo around it', () => {
    const box = groupHaloBounds([{ x: 100, y: 100, width: 120, height: 32 }], 10)!;
    expect(box.width).toBeGreaterThan(120);
    expect(box.width).toBeLessThan(160);
    expect(insideEllipse({ x: 160, y: 116 }, box)).toBe(true);
  });
});

describe('grouped overview layout', () => {
  const groups: MapGroup[] = [
    { id: 'group-0', index: 0, memberIds: ['1', '2', '3', '4', '5', '6'], label: 'Node 1' },
    { id: 'group-1', index: 1, memberIds: ['7', '8', '9', '10'], label: 'Node 7' },
  ];
  const nodes = Array.from({ length: 11 }, (_v, i) => dbNode(i + 1)); // node 11 is in no group

  it('puts nodes in no group into the Unlinked group and drops hidden members', () => {
    const visible = nodes.filter((node) => node.id !== 6);
    const result = withUngroupedAsUnlinked(groups, visible);

    expect(result.find((g) => g.index === 0)?.memberIds).toEqual(['1', '2', '3', '4', '5']);
    expect(result.find((g) => g.index === UNLINKED)?.memberIds).toEqual(['11']);
  });

  it('keeps each group in its own region with no overlap between groups', () => {
    const rfNodes = toRFNodes({
      nodes,
      viewMode: 'overview',
      degreeMap: new Map(),
      adjacency: new Map(),
      focusedGraph: null,
      groups,
      centerX: 0,
      centerY: 0,
    });
    const byId = new Map(rfNodes.map((node) => [node.id, node]));
    const halo = (memberIds: string[]) => groupHaloBounds(memberIds.map((id) => ({
      ...byId.get(id)!.position, width: 120, height: 32,
    })))!;

    const a = halo(groups[0].memberIds);
    const b = halo(groups[1].memberIds);
    // No point on either halo ellipse may fall inside the other ellipse.
    const outline = (box: typeof a) => Array.from({ length: 72 }, (_v, i) => {
      const angle = (i / 72) * Math.PI * 2;
      return { x: box.x + box.width / 2 + Math.cos(angle) * box.width / 2, y: box.y + box.height / 2 + Math.sin(angle) * box.height / 2 };
    });
    const strictlyInside = (point: { x: number; y: number }, box: typeof a) => {
      const dx = (point.x - (box.x + box.width / 2)) / (box.width / 2);
      const dy = (point.y - (box.y + box.height / 2)) / (box.height / 2);
      return dx * dx + dy * dy < 0.999;
    };
    expect(outline(a).some((point) => strictlyInside(point, b))).toBe(false);
    expect(outline(b).some((point) => strictlyInside(point, a))).toBe(false);

    expect(byId.get('1')?.data.group).toBe(0);
    expect(byId.get('7')?.data.group).toBe(1);
    expect(byId.get('11')?.data.group).toBeNull();
  });
});
