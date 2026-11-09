import { describe, expect, it } from 'vitest';
import { computeForceLayout, DEFAULT_FORCE_LAYOUT_OPTIONS, type Point } from '@/components/panes/map/forceLayout';

function circleSeed(ids: string[], radius = 300): Map<string, Point> {
  return new Map(ids.map((id, i) => {
    const angle = (i / ids.length) * Math.PI * 2;
    return [id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }];
  }));
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

describe('computeForceLayout', () => {
  it('returns an empty map for no nodes', () => {
    expect(computeForceLayout([], [], new Map(), new Map(), { x: 0, y: 0 }).size).toBe(0);
  });

  it('is deterministic for the same input', () => {
    const ids = Array.from({ length: 20 }, (_v, i) => `n${i}`);
    const links: Array<[string, string]> = ids.slice(1).map((id, i) => [ids[i], id]);
    const first = computeForceLayout(ids, links, new Map(), circleSeed(ids), { x: 0, y: 0 });
    const second = computeForceLayout(ids, links, new Map(), circleSeed(ids), { x: 0, y: 0 });
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it('places linked nodes closer than unlinked ones', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const links: Array<[string, string]> = [['a', 'b'], ['c', 'd'], ['e', 'f']];
    const out = computeForceLayout(ids, links, new Map(), circleSeed(ids), { x: 0, y: 0 });

    const linked = links.map(([x, y]) => dist(out.get(x)!, out.get(y)!));
    const unlinked = [['a', 'c'], ['a', 'e'], ['c', 'e'], ['b', 'd'], ['d', 'f']].map(([x, y]) => dist(out.get(x)!, out.get(y)!));
    expect(Math.max(...linked)).toBeLessThan(Math.min(...unlinked));
  });

  it('group gravity pulls same-group nodes together even without links', () => {
    const ids = Array.from({ length: 12 }, (_v, i) => `n${i}`);
    const groupOf = new Map(ids.map((id, i) => [id, i % 2]));
    const spreadOf = (groupGravity: number) => {
      const out = computeForceLayout(ids, [], groupOf, circleSeed(ids), { x: 0, y: 0 }, {
        ...DEFAULT_FORCE_LAYOUT_OPTIONS,
        groupGravity,
      });
      const evens = ids.filter((_id, i) => i % 2 === 0).map((id) => out.get(id)!);
      const cx = evens.reduce((s, p) => s + p.x, 0) / evens.length;
      const cy = evens.reduce((s, p) => s + p.y, 0) / evens.length;
      return evens.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / evens.length;
    };
    expect(spreadOf(3)).toBeLessThan(spreadOf(0));
  });

  it('removes node box overlaps and keeps every position finite, including isolated and coincident nodes', () => {
    const ids = Array.from({ length: 30 }, (_v, i) => `n${i}`);
    const links: Array<[string, string]> = ids.slice(1, 20).map((id) => [ids[0], id]); // a star + isolated nodes
    const allAtOrigin = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    const out = computeForceLayout(ids, links, new Map(), allAtOrigin, { x: 50, y: 50 });

    const { width, height } = DEFAULT_FORCE_LAYOUT_OPTIONS.nodeBox;
    const points = ids.map((id) => out.get(id)!);
    points.forEach((p) => expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true));
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const overlapping = Math.abs(points[i].x - points[j].x) < width - 0.5 && Math.abs(points[i].y - points[j].y) < height - 0.5;
        expect(overlapping).toBe(false);
      }
    }
  });
});
