import { describe, expect, it } from 'vitest';
import {
  createSpringState,
  pinBody,
  releaseBody,
  setSpringTargets,
  snapToTargets,
  springPositions,
  stepSpring,
  type Point,
  type SpringState,
} from '@/components/panes/map/springLayout';

function targets(entries: Record<string, Point>): Map<string, Point> {
  return new Map(Object.entries(entries));
}

function runUntilSettled(state: SpringState, maxSteps = 5000): number {
  for (let step = 0; step < maxSteps; step += 1) {
    if (!stepSpring(state)) return step;
  }
  throw new Error(`simulation did not settle within ${maxSteps} steps`);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

const TRIANGLE = targets({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, c: { x: 100, y: 180 } });
const TRIANGLE_LINKS: Array<[string, string]> = [['a', 'b'], ['b', 'c'], ['c', 'a']];

describe('springLayout', () => {
  it('rests exactly at the target layout once snapped (links at rest length, no motion)', () => {
    const state = createSpringState();
    setSpringTargets(state, TRIANGLE, TRIANGLE_LINKS);
    snapToTargets(state);

    expect(stepSpring(state)).toBe(false);
    const positions = springPositions(state);
    TRIANGLE.forEach((target, id) => {
      expect(positions.get(id)?.x).toBeCloseTo(target.x, 6);
      expect(positions.get(id)?.y).toBeCloseTo(target.y, 6);
    });
  });

  it('animates to new targets and settles close to them', () => {
    const state = createSpringState();
    setSpringTargets(state, TRIANGLE, TRIANGLE_LINKS);
    snapToTargets(state);

    const moved = targets({ a: { x: 400, y: 300 }, b: { x: 600, y: 300 }, c: { x: 500, y: 480 } });
    setSpringTargets(state, moved, TRIANGLE_LINKS);

    expect(stepSpring(state)).toBe(true);
    const steps = runUntilSettled(state);
    expect(steps).toBeGreaterThan(5);

    const positions = springPositions(state);
    moved.forEach((target, id) => {
      expect(dist(positions.get(id)!, target)).toBeLessThan(1);
    });
  });

  it('spawns a new body from a linked neighbour instead of its far-away target', () => {
    const state = createSpringState();
    setSpringTargets(state, targets({ hub: { x: 10, y: 20 } }), []);
    snapToTargets(state);

    setSpringTargets(
      state,
      targets({ hub: { x: 10, y: 20 }, leaf: { x: 500, y: 500 } }),
      [['hub', 'leaf']],
    );

    expect(springPositions(state).get('leaf')).toEqual({ x: 10, y: 20 });
    runUntilSettled(state);
    expect(dist(springPositions(state).get('leaf')!, { x: 500, y: 500 })).toBeLessThan(1);
  });

  it('blooms new unlinked bodies outward from a given origin', () => {
    const state = createSpringState();
    setSpringTargets(state, TRIANGLE, [], { bloomFrom: { x: 100, y: 60 } });

    const start = springPositions(state);
    TRIANGLE.forEach((target, id) => {
      // Each body starts near the origin, on the line toward its own target.
      expect(dist(start.get(id)!, { x: 100, y: 60 })).toBeLessThan(dist(target, { x: 100, y: 60 }) * 0.1);
    });

    runUntilSettled(state);
    const settled = springPositions(state);
    TRIANGLE.forEach((target, id) => expect(dist(settled.get(id)!, target)).toBeLessThan(1));
  });

  it('removes bodies that are no longer targeted and drops their links', () => {
    const state = createSpringState();
    setSpringTargets(state, TRIANGLE, TRIANGLE_LINKS);
    setSpringTargets(state, targets({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }), TRIANGLE_LINKS);

    expect([...state.bodies.keys()].sort()).toEqual(['a', 'b']);
    expect(state.links).toEqual([{ source: 'a', target: 'b', rest: 200 }]);
  });

  it('pulls linked neighbours toward a dragged body, and lets them return once released', () => {
    const state = createSpringState();
    setSpringTargets(state, TRIANGLE, TRIANGLE_LINKS);
    snapToTargets(state);

    pinBody(state, 'a', { x: -300, y: 0 });
    for (let i = 0; i < 30; i += 1) stepSpring(state);

    const bWhileDragging = springPositions(state).get('b')!;
    expect(bWhileDragging.x).toBeLessThan(200 - 5);
    expect(springPositions(state).get('a')).toEqual({ x: -300, y: 0 });

    releaseBody(state, 'a');
    runUntilSettled(state);

    const positions = springPositions(state);
    // The dropped body keeps its new place; its neighbours settle back to their own targets.
    expect(dist(positions.get('a')!, { x: -300, y: 0 })).toBeLessThan(1);
    expect(dist(positions.get('b')!, { x: 200, y: 0 })).toBeLessThan(1);
    expect(dist(positions.get('c')!, { x: 100, y: 180 })).toBeLessThan(1);
  });

  it('springs a released body back to its old target when the position is not kept', () => {
    const state = createSpringState();
    setSpringTargets(state, TRIANGLE, TRIANGLE_LINKS);
    snapToTargets(state);

    pinBody(state, 'c', { x: 100, y: 600 });
    releaseBody(state, 'c', false);
    runUntilSettled(state);

    expect(dist(springPositions(state).get('c')!, { x: 100, y: 180 })).toBeLessThan(1);
  });

  it('pushes overlapping bodies apart, including exactly coincident ones', () => {
    const state = createSpringState();
    setSpringTargets(state, targets({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }), []);
    snapToTargets(state);

    runUntilSettled(state);
    const positions = springPositions(state);
    expect(dist(positions.get('a')!, positions.get('b')!)).toBeGreaterThan(20);
  });

  it('settles within a bounded number of steps for a larger graph and clamps huge frame gaps', () => {
    const state = createSpringState();
    const layout = new Map<string, Point>();
    const links: Array<[string, string]> = [];
    for (let i = 0; i < 60; i += 1) {
      const angle = (i / 60) * Math.PI * 2;
      layout.set(`n${i}`, { x: Math.cos(angle) * 400, y: Math.sin(angle) * 400 });
      if (i > 0) links.push([`n${i - 1}`, `n${i}`]);
    }
    setSpringTargets(state, layout, links);

    // A stalled tab can hand us a 10 s frame; the step is clamped, so nothing explodes.
    stepSpring(state, undefined, 600);
    springPositions(state).forEach((point) => {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(Math.hypot(point.x, point.y)).toBeLessThan(2000);
    });

    expect(runUntilSettled(state, 3000)).toBeLessThan(3000);
  });
});

describe('springLayout stability for highly linked nodes', () => {
  it.each([1, 1.5])('settles a 199-link hub at step size %s', (dt) => {
    const layout = new Map<string, Point>([['hub', { x: 0, y: 0 }]]);
    const links: Array<[string, string]> = [];
    for (let i = 0; i < 199; i += 1) {
      const angle = (i / 199) * Math.PI * 2;
      layout.set(`n${i}`, { x: Math.cos(angle) * 300, y: Math.sin(angle) * 300 });
      links.push(['hub', `n${i}`]);
    }
    const state = createSpringState();
    setSpringTargets(state, layout, links);
    snapToTargets(state);
    state.bodies.get('hub')!.x += 10;

    let steps = 0;
    while (steps < 1000 && stepSpring(state, undefined, dt)) steps += 1;
    expect(steps).toBeLessThan(1000);
    const hub = state.bodies.get('hub')!;
    expect(Math.hypot(hub.x, hub.y)).toBeLessThan(1);
  });
});
