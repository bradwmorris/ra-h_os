import { describe, expect, it } from 'vitest';
import type { Node as DbNode } from '@/types/database';
import { UNLINKED } from '@/components/panes/map/communities';
import {
  groupHull,
  toRFNodes,
  withUngroupedAsUnlinked,
  type MapGroup,
} from '@/components/panes/map/utils';

function dbNode(id: number): DbNode {
  return { id, title: `Node ${id}`, edge_count: 0 } as unknown as DbNode;
}

describe('groupHull', () => {
  it('returns null for an empty group', () => {
    expect(groupHull([])).toBeNull();
  });

  it('encloses every padded node box and returns a closed path relative to its box', () => {
    const rects = [
      { x: 0, y: 0, width: 120, height: 32 },
      { x: 300, y: 40, width: 120, height: 32 },
      { x: 150, y: 200, width: 120, height: 32 },
    ];
    const hull = groupHull(rects, 10)!;

    expect(hull.x).toBe(-10);
    expect(hull.y).toBe(-10);
    expect(hull.x + hull.width).toBe(430);
    expect(hull.y + hull.height).toBe(242);
    expect(hull.path.startsWith('M ')).toBe(true);
    expect(hull.path.endsWith(' Z')).toBe(true);
    // Path coordinates are relative to the hull's own box.
    const numbers = hull.path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    numbers.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(-0.01);
      expect(value).toBeLessThanOrEqual(Math.max(hull.width, hull.height) + 0.01);
    });
  });

  it('is much smaller than the bounding ellipse for a diagonal group', () => {
    const rects = [0, 1, 2, 3].map((i) => ({ x: i * 150, y: i * 60, width: 120, height: 32 }));
    const hull = groupHull(rects, 0)!;
    // A convex hull of a diagonal strip has the full bounding box but is drawn as a thin band:
    // check the box is just the strip's extent (no ellipse inflation).
    expect(hull.width).toBe(3 * 150 + 120);
    expect(hull.height).toBe(3 * 60 + 32);
  });
});

describe('overview layout', () => {
  // Two 5-node cliques joined by one bridge, plus an isolated node.
  const nodes = Array.from({ length: 11 }, (_v, i) => dbNode(i + 1));
  const groups: MapGroup[] = [
    { id: 'group-0', index: 0, memberIds: ['1', '2', '3', '4', '5'], label: 'Node 1' },
    { id: 'group-1', index: 1, memberIds: ['6', '7', '8', '9', '10'], label: 'Node 6' },
  ];
  const adjacency = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const clique of [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]) {
    clique.forEach((a, i) => clique.slice(i + 1).forEach((b) => link(a, b)));
  }
  link(5, 6);

  const layout = () => toRFNodes({
    nodes,
    viewMode: 'overview',
    degreeMap: new Map(),
    adjacency,
    focusedGraph: null,
    groups,
    centerX: 0,
    centerY: 0,
  });

  it('puts nodes in no group into the Unlinked group and drops hidden members', () => {
    const visible = nodes.filter((node) => node.id !== 6);
    const result = withUngroupedAsUnlinked(groups, visible);

    expect(result.find((g) => g.index === 0)?.memberIds).toEqual(['1', '2', '3', '4', '5']);
    expect(result.find((g) => g.index === UNLINKED)?.memberIds).toEqual(['11']);
  });

  it('is deterministic and tags every node with its group', () => {
    const first = layout();
    const second = layout();
    expect(second.map((n) => n.position)).toEqual(first.map((n) => n.position));

    const byId = new Map(first.map((node) => [node.id, node]));
    expect(byId.get('1')?.data.group).toBe(0);
    expect(byId.get('7')?.data.group).toBe(1);
    expect(byId.get('11')?.data.group).toBeNull();
  });

  it('keeps groups cohesive while the bridged groups stay close, and nodes do not overlap', () => {
    const byId = new Map(layout().map((node) => [node.id, node.position]));
    const dist = (a: string, b: string) => {
      const p = byId.get(a)!;
      const q = byId.get(b)!;
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    const mean = (pairs: Array<[string, string]>) => pairs.reduce((sum, [a, b]) => sum + dist(a, b), 0) / pairs.length;

    const a = ['1', '2', '3', '4', '5'];
    const b = ['6', '7', '8', '9', '10'];
    const within: Array<[string, string]> = [];
    const across: Array<[string, string]> = [];
    a.forEach((x, i) => a.slice(i + 1).forEach((y) => within.push([x, y])));
    b.forEach((x, i) => b.slice(i + 1).forEach((y) => within.push([x, y])));
    a.forEach((x) => b.forEach((y) => across.push([x, y])));

    expect(mean(within)).toBeLessThan(mean(across));
    // The bridge is not stretched far beyond a normal link (groups are not walled apart).
    expect(dist('5', '6')).toBeLessThan(mean(across) * 1.5);

    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const p = byId.get(ids[i])!;
        const q = byId.get(ids[j])!;
        const overlapping = Math.abs(p.x - q.x) < 120 && Math.abs(p.y - q.y) < 32;
        expect(overlapping).toBe(false);
      }
    }
  });
});
