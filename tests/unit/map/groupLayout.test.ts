import { describe, expect, it } from 'vitest';
import type { Node as DbNode } from '@/types/database';
import { UNLINKED } from '@/components/panes/map/communities';
import { DEFAULT_FORCE_LAYOUT_OPTIONS } from '@/components/panes/map/forceLayout';
import {
  applyDragOverrides,
  computeTimelineLayout,
  createdAtTimes,
  groupBand,
  groupHull,
  packDisconnectedComponents,
  planCamera,
  toRFEdges,
  toRFNodes,
  withUngroupedAsUnlinked,
  isOverviewLayout,
  OVERVIEW_LAYOUTS,
  type MapGroup,
  type OverviewLayout,
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
    overviewLayout: 'grouped',
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
        const { width, height } = DEFAULT_FORCE_LAYOUT_OPTIONS.nodeBox;
        const overlapping = Math.abs(p.x - q.x) < width - 0.5 && Math.abs(p.y - q.y) < height - 0.5;
        expect(overlapping).toBe(false);
      }
    }
  });
});

describe('overview layout modes', () => {
  const dated = (id: number, day: number) => ({
    id,
    title: `Node ${id}`,
    edge_count: 0,
    created_at: new Date(Date.UTC(2026, 0, 1 + day)).toISOString(),
  }) as unknown as DbNode;
  // Group 0: nodes 1-4 (created out of id order), group 1: nodes 5-7, plus an unparseable date.
  const nodes = [dated(1, 9), dated(2, 1), dated(3, 5), dated(4, 3), dated(5, 2), dated(6, 8), dated(7, 4)];
  nodes.push({ ...dated(8, 0), created_at: 'not a date' } as unknown as DbNode);
  const groups: MapGroup[] = [
    { id: 'group-0', index: 0, memberIds: ['1', '2', '3', '4'], label: 'Node 1' },
    { id: 'group-1', index: 1, memberIds: ['5', '6', '7', '8'], label: 'Node 5' },
  ];
  const adjacency = new Map<number, Set<number>>([
    [1, new Set([2, 3, 4])], [2, new Set([1])], [3, new Set([1])], [4, new Set([1, 5])],
    [5, new Set([4, 6, 7])], [6, new Set([5])], [7, new Set([5])],
  ]);
  const layout = (overviewLayout: OverviewLayout) => toRFNodes({
    nodes, viewMode: 'overview', degreeMap: new Map(), adjacency, focusedGraph: null,
    groups, overviewLayout, centerX: 0, centerY: 0,
  });

  it.each(OVERVIEW_LAYOUTS)('%s gives every node a finite, deterministic position', (mode) => {
    const first = layout(mode);
    expect(first).toHaveLength(nodes.length);
    first.forEach((node) => {
      expect(Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).toBe(true);
    });
    expect(layout(mode).map((node) => node.position)).toEqual(first.map((node) => node.position));
  });

  it('original layout shows no group colours; the others keep them', () => {
    expect(layout('original').every((node) => node.data.group === null)).toBe(true);
    expect(layout('grouped').find((node) => node.id === '1')?.data.group).toBe(0);
  });

  it('timeline orders each lane left to right by creation date, one lane per group', () => {
    const byId = new Map(layout('timeline').map((node) => [node.id, node.position]));
    const x = (id: string) => byId.get(id)!.x;
    // Group 0 by date: 2 (day 1), 4 (day 3), 3 (day 5), 1 (day 9).
    expect(x('2')).toBeLessThan(x('4'));
    expect(x('4')).toBeLessThan(x('3'));
    expect(x('3')).toBeLessThan(x('1'));
    // Lanes are stacked: every group-1 node sits below every group-0 node.
    const lowestOfGroup0 = Math.max(...['1', '2', '3', '4'].map((id) => byId.get(id)!.y));
    ['5', '6', '7'].forEach((id) => expect(byId.get(id)!.y).toBeGreaterThan(lowestOfGroup0));
  });

  it('network differs from grouped (no group pull)', () => {
    const grouped = layout('grouped').map((node) => node.position);
    const network = layout('network').map((node) => node.position);
    expect(network).not.toEqual(grouped);
  });

  it('recognises valid layout names only', () => {
    expect(isOverviewLayout('timeline')).toBe(true);
    expect(isOverviewLayout('spiral')).toBe(false);
    expect(isOverviewLayout(undefined)).toBe(false);
  });
});

describe('timeline helpers', () => {
  it('computes monthly ticks inside the time range for spans over four months', () => {
    const groups: MapGroup[] = [{ id: 'group-0', index: 0, memberIds: ['a', 'b'], label: 'A' }];
    const times = new Map([['a', Date.UTC(2026, 4, 13)], ['b', Date.UTC(2026, 10, 9)]]);
    const timeline = computeTimelineLayout(groups, times, 0, 0);
    expect(timeline.ticks.map((tick) => tick.label)).toEqual(['Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026']);
    const xa = timeline.positions.get('a')!.x;
    const xb = timeline.positions.get('b')!.x;
    timeline.ticks.forEach((tick) => {
      expect(tick.x).toBeGreaterThan(xa);
      expect(tick.x).toBeLessThanOrEqual(xb);
    });
  });

  it('skips unparseable dates', () => {
    const nodes = [
      { id: 1, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, created_at: 'nope' },
    ] as unknown as DbNode[];
    expect([...createdAtTimes(nodes).keys()]).toEqual(['1']);
  });

  it('draws timeline lanes as rounded rectangles enclosing every box', () => {
    const band = groupBand([{ x: 0, y: 0, width: 50, height: 20 }, { x: 200, y: 60, width: 50, height: 20 }], 10)!;
    expect(band).toMatchObject({ x: -10, y: -10, width: 270, height: 100 });
    expect(band.path.startsWith('M ')).toBe(true);
    expect(band.path.endsWith('Z')).toBe(true);
  });
});

describe('packDisconnectedComponents', () => {
  it('keeps the largest component in place and packs the rest in rows just below it', () => {
    const centres = new Map<string, { x: number; y: number }>([
      // Main component: a-b-c around the origin.
      ['a', { x: -200, y: 0 }], ['b', { x: 0, y: 50 }], ['c', { x: 200, y: 0 }],
      // A linked pair and a loner that drifted far away.
      ['p', { x: 5000, y: -4000 }], ['q', { x: 5100, y: -4000 }],
      ['z', { x: -9000, y: 9000 }],
    ]);
    const links: Array<[string, string]> = [['a', 'b'], ['b', 'c'], ['p', 'q']];
    const out = packDisconnectedComponents(centres, links);

    // Main component untouched.
    ['a', 'b', 'c'].forEach((id) => expect(out.get(id)).toEqual(centres.get(id)));
    // Pair keeps its shape.
    expect(out.get('q')!.x - out.get('p')!.x).toBeCloseTo(100);
    expect(out.get('q')!.y - out.get('p')!.y).toBeCloseTo(0);
    // Everything else now sits just below the main component, nowhere near where it drifted.
    const mainBottom = 50;
    ['p', 'q', 'z'].forEach((id) => {
      const point = out.get(id)!;
      expect(point.y).toBeGreaterThan(mainBottom);
      expect(point.y).toBeLessThan(mainBottom + 400);
      expect(Math.abs(point.x)).toBeLessThan(1000);
    });
  });

  it('returns the input unchanged when the graph is connected', () => {
    const centres = new Map([['a', { x: 1, y: 2 }], ['b', { x: 3, y: 4 }]]);
    expect(packDisconnectedComponents(centres, [['a', 'b']])).toBe(centres);
  });
});

describe('overview edge colours', () => {
  it('colours links inside a group and fades links between groups', () => {
    const dbEdges = [
      { id: 1, from_node_id: 1, to_node_id: 2, context: null },
      { id: 2, from_node_id: 2, to_node_id: 3, context: null },
    ] as unknown as Parameters<typeof toRFEdges>[0]['dbEdges'];
    const groupOf = new Map([['1', 0], ['2', 0], ['3', 1]]);
    const edges = toRFEdges({ dbEdges, nodeIds: new Set(['1', '2', '3']), focusedGraph: null, groupOf });
    expect(edges[0].style?.stroke).toBe('var(--rah-map-group-0)');
    expect(Number(edges[1].style?.opacity)).toBeLessThan(Number(edges[0].style?.opacity));

    const neutral = toRFEdges({ dbEdges, nodeIds: new Set(['1', '2', '3']), focusedGraph: null });
    expect(neutral[0].style?.stroke).toBe('#475569');
  });
});

describe('applyDragOverrides', () => {
  it('keeps dragged positions over regenerated targets and prunes overrides for missing nodes', () => {
    const targets = new Map([['a', { x: 0, y: 0 }], ['b', { x: 10, y: 10 }]]);
    const overrides = new Map([['a', { x: 500, y: 500 }], ['gone', { x: 1, y: 1 }]]);
    applyDragOverrides(targets, overrides);
    expect(targets.get('a')).toEqual({ x: 500, y: 500 });
    expect(targets.get('b')).toEqual({ x: 10, y: 10 });
    expect(overrides.has('gone')).toBe(false);
    expect(overrides.has('a')).toBe(true);
  });
});

describe('groupHull containment', () => {
  // Flatten the outline path (M / L / Q commands) into a polygon by sampling the curves.
  function pathToPolygon(path: string): Array<{ x: number; y: number }> {
    const tokens = path.match(/[MLQZ]|-?\d+(?:\.\d+)?/g)!;
    const points: Array<{ x: number; y: number }> = [];
    let current = { x: 0, y: 0 };
    for (let i = 0; i < tokens.length;) {
      const command = tokens[i++];
      if (command === 'Z') continue;
      if (command === 'M' || command === 'L') {
        current = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
        points.push(current);
      } else if (command === 'Q') {
        const control = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
        const end = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
        for (let t = 0.1; t <= 1.0001; t += 0.1) {
          const u = 1 - t;
          points.push({
            x: u * u * current.x + 2 * u * t * control.x + t * t * end.x,
            y: u * u * current.y + 2 * u * t * control.y + t * t * end.y,
          });
        }
        current = end;
      }
    }
    return points;
  }

  function inside(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const a = polygon[i];
      const b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
        result = !result;
      }
    }
    return result;
  }

  const layouts: Record<string, Array<{ x: number; y: number; width: number; height: number }>> = {
    'three in a row': [0, 300, 600].map((x) => ({ x, y: 0, width: 120, height: 32 })),
    diagonal: [0, 1, 2, 3].map((i) => ({ x: i * 150, y: i * 60, width: 120, height: 32 })),
    scattered: [
      { x: 0, y: 0, width: 120, height: 32 }, { x: 400, y: 30, width: 90, height: 32 },
      { x: 180, y: 260, width: 168, height: 32 }, { x: -120, y: 140, width: 120, height: 32 },
    ],
  };

  it.each(Object.keys(layouts))('keeps every member box inside the outline (%s)', (name) => {
    const rects = layouts[name];
    const hull = groupHull(rects)!;
    const polygon = pathToPolygon(hull.path).map((p) => ({ x: p.x + hull.x, y: p.y + hull.y }));
    rects.forEach((rect) => {
      const corners = [
        { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
      ];
      corners.forEach((corner) => expect(inside(corner, polygon)).toBe(true));
    });
  });
});

describe('planCamera', () => {
  const targets = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 400, y: 100 }],
    ['c', { x: -200, y: 300 }],
  ]);
  const nodeSize = { width: 168, height: 36 };
  const base = { targets, outlineGroups: [], ticks: [], nodeSize };

  it('centres the focused note for automatic fits', () => {
    expect(planCamera({ ...base, focusId: 'b', fitAll: false })).toEqual({ kind: 'center', x: 400, y: 100 });
  });

  it('frames everything for a manual fit, even in the focused view', () => {
    const plan = planCamera({ ...base, focusId: 'b', fitAll: true });
    expect(plan).toEqual({ kind: 'bounds', x: -200, y: 0, width: 400 + 168 + 200, height: 300 + 36 });
  });

  it('returns null when the focused note is not available yet, or there is nothing to frame', () => {
    expect(planCamera({ ...base, focusId: 'missing', fitAll: false })).toBeNull();
    expect(planCamera({ ...base, targets: new Map(), focusId: null, fitAll: true })).toBeNull();
  });

  it('includes outlines and timeline tick labels in the bounds', () => {
    const withTick = planCamera({ ...base, focusId: null, fitAll: false, ticks: [{ x: 0, y: -300 }] });
    expect(withTick?.kind).toBe('bounds');
    expect(withTick && 'y' in withTick ? withTick.y : 0).toBe(-300);

    const group: MapGroup = { id: 'group-0', index: 0, memberIds: ['a', 'b', 'c'], label: 'A' };
    const plain = planCamera({ ...base, focusId: null, fitAll: false })!;
    const outlined = planCamera({ ...base, focusId: null, fitAll: false, outlineGroups: [group] })!;
    expect(outlined.kind === 'bounds' && plain.kind === 'bounds' && outlined.y).toBeLessThan(plain.kind === 'bounds' ? plain.y : 0);
  });
});

describe('timeline without any valid dates', () => {
  it('still places every note in its lane at the start of the timeline', () => {
    const groups: MapGroup[] = [
      { id: 'group-0', index: 0, memberIds: ['a', 'b'], label: 'A' },
      { id: 'group-1', index: 1, memberIds: ['c'], label: 'C' },
    ];
    const timeline = computeTimelineLayout(groups, new Map(), 0, 0);
    expect([...timeline.positions.keys()].sort()).toEqual(['a', 'b', 'c']);
    const points = [...timeline.positions.values()];
    // Everyone starts at the same (earliest) x, but no two notes share a position.
    expect(new Set(points.map((p) => p.x)).size).toBe(1);
    expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(3);
    expect(timeline.ticks).toEqual([]);
  });
});
