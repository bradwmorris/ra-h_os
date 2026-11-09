/**
 * Framework-agnostic spring simulation for animating a graph toward a target layout.
 *
 * Every body is pulled toward its anchor (its target layout position), linked bodies
 * are joined by springs whose rest length is the distance between their anchors, and
 * bodies closer than `collisionRadius` push apart. Because link rest lengths match the
 * anchor geometry, the resting state is exactly the target layout: motion appears only
 * when something perturbs it (a new target, or a body pinned somewhere else while dragged).
 *
 * Pure data in, data out: no DOM, React or graph-library imports.
 */

export interface Point {
  x: number;
  y: number;
}

export interface SpringBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  anchorX: number;
  anchorY: number;
  /** Pinned bodies hold their position (e.g. while being dragged) and only exert force. */
  pinned: boolean;
  /** Number of links attached; sets the body's mass (see stepSpring). */
  degree: number;
}

export interface SpringLink {
  source: string;
  target: string;
  rest: number;
}

export interface SpringParams {
  /** Pull toward the body's own anchor. */
  anchorStrength: number;
  /** Pull along links toward their rest length. */
  linkStrength: number;
  /** Bodies closer than this push apart. */
  collisionRadius: number;
  collisionStrength: number;
  /** Fraction of velocity kept each step (0..1). */
  damping: number;
  /** Per-step speed cap, keeps large retargets from overshooting wildly. */
  maxSpeed: number;
  /** The simulation is settled when every speed and residual force is below this. */
  restThreshold: number;
}

// Largest stiffness/mass ratio that settles reliably at the step sizes useSpringLayout uses.
const MAX_STABLE_STIFFNESS = 0.5;

export const DEFAULT_SPRING_PARAMS: SpringParams = {
  anchorStrength: 0.035,
  linkStrength: 0.05,
  // Small enough not to fight the target layout, which already keeps node boxes apart;
  // this only stops nodes piling up while they move or are dragged.
  collisionRadius: 30,
  collisionStrength: 0.35,
  damping: 0.8,
  maxSpeed: 48,
  restThreshold: 0.02,
};

export interface SpringState {
  bodies: Map<string, SpringBody>;
  links: SpringLink[];
}

export function createSpringState(): SpringState {
  return { bodies: new Map(), links: [] };
}

const BLOOM_START_FRACTION = 0.08;

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function anchorOf(body: SpringBody): Point {
  return { x: body.anchorX, y: body.anchorY };
}

function recomputeLinkRests(state: SpringState): void {
  for (const link of state.links) {
    const source = state.bodies.get(link.source);
    const target = state.bodies.get(link.target);
    if (source && target) link.rest = distance(anchorOf(source), anchorOf(target));
  }
}

/**
 * Point a newly added body should start from: the current position of an already
 * present linked body (so it grows out of its neighbour), else the centroid of the
 * existing bodies, else its own anchor.
 */
function spawnPoint(
  id: string,
  anchor: Point,
  existing: Map<string, SpringBody>,
  links: Array<[string, string]>,
  bloomFrom?: Point,
): Point {
  for (const [a, b] of links) {
    const other = a === id ? b : b === id ? a : null;
    const body = other ? existing.get(other) : undefined;
    if (body) return { x: body.x, y: body.y };
  }
  if (bloomFrom) {
    // Start just outside the origin along the body's own direction, so bodies fan out
    // from a common point without starting exactly on top of each other.
    return {
      x: bloomFrom.x + (anchor.x - bloomFrom.x) * BLOOM_START_FRACTION,
      y: bloomFrom.y + (anchor.y - bloomFrom.y) * BLOOM_START_FRACTION,
    };
  }
  if (existing.size > 0) {
    let sx = 0;
    let sy = 0;
    existing.forEach((body) => {
      sx += body.x;
      sy += body.y;
    });
    return { x: sx / existing.size, y: sy / existing.size };
  }
  return anchor;
}

export interface SetTargetsOptions {
  /**
   * Origin for new bodies that have no already-present linked neighbour, e.g. the layout
   * centre on first load so the graph blooms outward. Without it they spawn at the
   * centroid of the existing bodies, or directly at their target when there are none.
   */
  bloomFrom?: Point;
}

/**
 * Replace the target layout. Existing bodies keep their position and velocity and are
 * re-anchored; new bodies spawn from a linked neighbour; bodies not in `targets` are removed.
 */
export function setSpringTargets(
  state: SpringState,
  targets: Map<string, Point>,
  links: Array<[string, string]>,
  options: SetTargetsOptions = {},
): void {
  const previous = state.bodies;
  const next = new Map<string, SpringBody>();

  targets.forEach((anchor, id) => {
    const body = previous.get(id);
    if (body) {
      next.set(id, { ...body, anchorX: anchor.x, anchorY: anchor.y, degree: 0 });
      return;
    }
    const start = spawnPoint(id, anchor, previous, links, options.bloomFrom);
    next.set(id, { x: start.x, y: start.y, vx: 0, vy: 0, anchorX: anchor.x, anchorY: anchor.y, pinned: false, degree: 0 });
  });

  state.bodies = next;
  state.links = links
    .filter(([source, target]) => source !== target && next.has(source) && next.has(target))
    .map(([source, target]) => ({ source, target, rest: 0 }));
  for (const link of state.links) {
    next.get(link.source)!.degree += 1;
    next.get(link.target)!.degree += 1;
  }
  recomputeLinkRests(state);
}

/** Jump every body to its anchor and stop all motion (used for reduced motion). */
export function snapToTargets(state: SpringState): void {
  state.bodies.forEach((body) => {
    if (body.pinned) return;
    body.x = body.anchorX;
    body.y = body.anchorY;
    body.vx = 0;
    body.vy = 0;
  });
}

/** Hold a body at `point` (e.g. under the pointer while dragging). */
export function pinBody(state: SpringState, id: string, point: Point): void {
  const body = state.bodies.get(id);
  if (!body) return;
  body.pinned = true;
  body.x = point.x;
  body.y = point.y;
  body.vx = 0;
  body.vy = 0;
}

/**
 * Release a pinned body. With `keepPosition`, the body's anchor moves to where it was
 * dropped (and its link rest lengths follow), so the user's arrangement persists and
 * its neighbours settle back to their own anchors.
 */
export function releaseBody(state: SpringState, id: string, keepPosition = true): void {
  const body = state.bodies.get(id);
  if (!body) return;
  body.pinned = false;
  if (keepPosition) {
    body.anchorX = body.x;
    body.anchorY = body.y;
    recomputeLinkRests(state);
  }
}

/**
 * Advance the simulation by one step. `dt` is in units of a 60 fps frame (1 = 16.7 ms)
 * and is clamped so a stalled tab cannot produce a huge jump. Returns true while still
 * moving, false once settled.
 */
export function stepSpring(state: SpringState, params: SpringParams = DEFAULT_SPRING_PARAMS, dt = 1): boolean {
  const step = Math.min(Math.max(dt, 0), 3);
  const forces = new Map<string, Point>();
  state.bodies.forEach((_body, id) => forces.set(id, { x: 0, y: 0 }));

  state.bodies.forEach((body, id) => {
    const force = forces.get(id);
    if (!force) return;
    force.x += (body.anchorX - body.x) * params.anchorStrength;
    force.y += (body.anchorY - body.y) * params.anchorStrength;
  });

  for (const link of state.links) {
    const source = state.bodies.get(link.source);
    const target = state.bodies.get(link.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.hypot(dx, dy) || 1;
    const pull = (length - link.rest) * params.linkStrength;
    const fx = (dx / length) * pull;
    const fy = (dy / length) * pull;
    const sourceForce = forces.get(link.source);
    const targetForce = forces.get(link.target);
    if (sourceForce) {
      sourceForce.x += fx;
      sourceForce.y += fy;
    }
    if (targetForce) {
      targetForce.x -= fx;
      targetForce.y -= fy;
    }
  }

  const entries = [...state.bodies.entries()];
  const radius = params.collisionRadius;
  for (let i = 0; i < entries.length; i += 1) {
    const [leftId, left] = entries[i];
    for (let j = i + 1; j < entries.length; j += 1) {
      const [rightId, right] = entries[j];
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let length = Math.hypot(dx, dy);
      if (length >= radius) continue;
      if (length < 1e-6) {
        // Coincident bodies: separate along a stable, id-derived direction.
        const angle = ((i * 7919 + j * 104729) % 360) * (Math.PI / 180);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        length = 1;
      }
      const push = (radius - length) * params.collisionStrength * 0.5;
      const fx = (dx / length) * push;
      const fy = (dy / length) * push;
      const leftForce = forces.get(leftId);
      const rightForce = forces.get(rightId);
      if (leftForce) {
        leftForce.x -= fx;
        leftForce.y -= fy;
      }
      if (rightForce) {
        rightForce.x += fx;
        rightForce.y += fy;
      }
    }
  }

  let moving = false;
  const damping = Math.pow(params.damping, step);
  state.bodies.forEach((body, id) => {
    if (body.pinned) {
      body.vx = 0;
      body.vy = 0;
      return;
    }
    const force = forces.get(id) ?? { x: 0, y: 0 };
    // A body's effective stiffness grows with its links (each pulls on it). Explicit
    // integration goes unstable once stiffness/mass is too high, so heavily linked hubs
    // get proportionally more mass: they move less per step but always settle.
    const stiffness = params.anchorStrength + params.linkStrength * body.degree;
    const mass = Math.max(1, stiffness / MAX_STABLE_STIFFNESS);
    body.vx = (body.vx + (force.x / mass) * step) * damping;
    body.vy = (body.vy + (force.y / mass) * step) * damping;
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > params.maxSpeed) {
      body.vx = (body.vx / speed) * params.maxSpeed;
      body.vy = (body.vy / speed) * params.maxSpeed;
    }
    body.x += body.vx * step;
    body.y += body.vy * step;
    if (Math.hypot(body.vx, body.vy) > params.restThreshold || Math.hypot(force.x, force.y) > params.restThreshold) {
      moving = true;
    }
  });

  return moving;
}

export function springPositions(state: SpringState): Map<string, Point> {
  const positions = new Map<string, Point>();
  state.bodies.forEach((body, id) => positions.set(id, { x: body.x, y: body.y }));
  return positions;
}
