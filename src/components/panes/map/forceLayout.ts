/**
 * Deterministic ForceAtlas2-style layout with a soft "group gravity", for laying out a
 * knowledge graph so communities emerge from the links themselves instead of being
 * boxed into separate regions.
 *
 * - Repulsion between every pair, scaled by (degree + 1) of both nodes, falling off
 *   with distance (ForceAtlas2).
 * - Attraction along each link: linear by default (ForceAtlas2), or Noack's LinLog
 *   log(1 + distance), which separates clusters further (see `attraction`).
 * - Gravity toward the centre with constant magnitude per node, so unlinked nodes do
 *   not drift away.
 * - Group gravity toward each group's current centroid, so a community stays together
 *   without walls between communities (the "group force" Obsidian users ask for).
 * - A final collision pass so node boxes do not overlap.
 *
 * Nodes are much wider than tall, so the simulation runs in a horizontally compressed
 * space (x / ASPECT) where a node box is roughly circular, then stretches back.
 *
 * Pure data in, data out: same input, same output. No DOM, React or graph-library imports.
 */

export interface Point {
  x: number;
  y: number;
}

export interface ForceLayoutOptions {
  iterations: number;
  /** ForceAtlas2 repulsion scaling (kr). */
  repulsion: number;
  /** Pull toward the layout centre (kg). */
  gravity: number;
  /** Pull toward the node's group centroid; 0 disables grouping. */
  groupGravity: number;
  /** Target median link length in output pixels after scaling. */
  linkLength: number;
  /** Horizontal stretch: node boxes are about this many times wider than tall. */
  aspect: number;
  /**
   * 'linear' (ForceAtlas2 default): attraction grows with distance, which keeps groups
   * close together with short bridges. 'linlog' (Noack): log(1 + distance), which pushes
   * clusters further apart; better for spotting clusters, worse for seeing connections.
   */
  attraction: 'linear' | 'linlog';
  /** Rendered node box (plus margin) used by the final overlap-removal pass. */
  nodeBox: { width: number; height: number };
}

// Tuned on a real 135-node / 227-link graph, between a looser layout (room for full
// labels) and a dense one (room for icons only). Linear attraction keeps links between
// groups short; group gravity keeps communities together. The node box reserves room
// for an icon plus a short label; full labels appear as you zoom in.
export const DEFAULT_FORCE_LAYOUT_OPTIONS: ForceLayoutOptions = {
  iterations: 300,
  repulsion: 2.5,
  gravity: 1.05,
  groupGravity: 3,
  linkLength: 110,
  aspect: 1.8,
  attraction: 'linear',
  nodeBox: { width: 96, height: 34 },
};

interface Body {
  id: string;
  x: number;
  y: number;
  degree: number;
  group: number | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute a layout. `seed` gives every node's starting position (missing ids start at
 * `center`); `groupOf` maps ids to a group (null = no group pull). Output positions are
 * node centres in the same coordinate space as `seed`, re-centred on `center`.
 */
export function computeForceLayout(
  ids: string[],
  links: Array<[string, string]>,
  groupOf: Map<string, number | null>,
  seed: Map<string, Point>,
  center: Point,
  options: ForceLayoutOptions = DEFAULT_FORCE_LAYOUT_OPTIONS,
): Map<string, Point> {
  const result = new Map<string, Point>();
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return result;

  const index = new Map(uniqueIds.map((id, i) => [id, i]));
  const pairKeys = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const [source, target] of links) {
    const a = index.get(source);
    const b = index.get(target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (pairKeys.has(key)) continue;
    pairKeys.add(key);
    edges.push([a, b]);
  }

  const degree = new Array<number>(uniqueIds.length).fill(0);
  edges.forEach(([a, b]) => {
    degree[a] += 1;
    degree[b] += 1;
  });

  const { aspect } = options;
  const bodies: Body[] = uniqueIds.map((id, i) => {
    const start = seed.get(id) ?? center;
    return {
      id,
      // Compressed space, centred on the origin.
      x: (start.x - center.x) / aspect,
      y: start.y - center.y,
      degree: degree[i],
      group: groupOf.get(id) ?? null,
    };
  });

  const n = bodies.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  // Initial step cap ~ the seed's spread, cooling linearly to a small value.
  const spread = Math.max(...bodies.map((b) => Math.hypot(b.x, b.y)), 50);
  const startTemperature = spread / 6;

  for (let step = 0; step < options.iterations; step += 1) {
    fx.fill(0);
    fy.fill(0);

    // Repulsion (ForceAtlas2): kr * (d_i + 1)(d_j + 1) / distance.
    for (let i = 0; i < n; i += 1) {
      const a = bodies[i];
      for (let j = i + 1; j < n; j += 1) {
        const b = bodies[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-6) {
          // Coincident: separate along a stable, index-derived direction.
          const angle = ((i * 7919 + j * 104729) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const magnitude = (options.repulsion * (a.degree + 1) * (b.degree + 1) * 100) / distance;
        const ux = dx / distance;
        const uy = dy / distance;
        fx[i] += ux * magnitude;
        fy[i] += uy * magnitude;
        fx[j] -= ux * magnitude;
        fy[j] -= uy * magnitude;
      }
    }

    // LinLog attraction along links: log(1 + distance).
    for (const [i, j] of edges) {
      const dx = bodies[j].x - bodies[i].x;
      const dy = bodies[j].y - bodies[i].y;
      const distance = Math.hypot(dx, dy);
      if (distance < 1e-6) continue;
      const magnitude = options.attraction === 'linlog' ? Math.log(1 + distance) * 10 : distance * 0.1;
      fx[i] += (dx / distance) * magnitude;
      fy[i] += (dy / distance) * magnitude;
      fx[j] -= (dx / distance) * magnitude;
      fy[j] -= (dy / distance) * magnitude;
    }

    // Group centroids for this step.
    const centroids = new Map<number, { x: number; y: number; count: number }>();
    for (const body of bodies) {
      if (body.group === null) continue;
      const c = centroids.get(body.group) ?? { x: 0, y: 0, count: 0 };
      c.x += body.x;
      c.y += body.y;
      c.count += 1;
      centroids.set(body.group, c);
    }

    for (let i = 0; i < n; i += 1) {
      const body = bodies[i];
      // Gravity toward the centre, constant magnitude scaled by degree (ForceAtlas2).
      const toCentre = Math.hypot(body.x, body.y);
      if (toCentre > 1e-6) {
        const g = options.gravity * (body.degree + 1) * 10;
        fx[i] -= (body.x / toCentre) * g;
        fy[i] -= (body.y / toCentre) * g;
      }
      // Soft group gravity toward the group's centroid.
      if (body.group !== null && options.groupGravity > 0) {
        const c = centroids.get(body.group);
        if (c && c.count > 1) {
          const cx = c.x / c.count - body.x;
          const cy = c.y / c.count - body.y;
          const d = Math.hypot(cx, cy);
          if (d > 1e-6) {
            const g = options.groupGravity * (body.degree + 1) * 10;
            fx[i] += (cx / d) * g;
            fy[i] += (cy / d) * g;
          }
        }
      }
    }

    // Move each body along its force, capped by a cooling temperature (stable,
    // deterministic convergence).
    const temperature = startTemperature * (1 - step / options.iterations) + 0.5;
    for (let i = 0; i < n; i += 1) {
      const magnitude = Math.hypot(fx[i], fy[i]);
      if (magnitude < 1e-9) continue;
      const move = Math.min(magnitude / ((bodies[i].degree + 1) * 10), temperature);
      bodies[i].x += (fx[i] / magnitude) * move;
      bodies[i].y += (fy[i] / magnitude) * move;
    }
  }

  // Scale so the median link has the requested on-screen length.
  const linkLengths = edges.map(([i, j]) => Math.hypot(
    (bodies[j].x - bodies[i].x) * aspect,
    bodies[j].y - bodies[i].y,
  ));
  const currentMedian = median(linkLengths);
  const scale = currentMedian > 1e-6 ? options.linkLength / currentMedian : 1;
  for (const body of bodies) {
    body.x *= scale;
    body.y *= scale;
  }

  // Back to real (uncompressed) space, then remove box overlaps: for each overlapping
  // pair, separate along the axis that needs the smaller move. Boxes are wide, so most
  // separations happen vertically, which keeps neighbours close.
  const points = bodies.map((body) => ({ x: body.x * aspect, y: body.y }));
  const { width: boxW, height: boxH } = options.nodeBox;
  for (let pass = 0; pass < 80; pass += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dx = points[j].x - points[i].x;
        const dy = points[j].y - points[i].y;
        const overlapX = boxW - Math.abs(dx);
        const overlapY = boxH - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapY <= overlapX) {
          const push = overlapY / 2 + 0.01;
          // Stable direction for exact ties: lower index goes up.
          const sign = dy !== 0 ? Math.sign(dy) : 1;
          points[i].y -= sign * push;
          points[j].y += sign * push;
        } else {
          const push = overlapX / 2 + 0.01;
          const sign = dx !== 0 ? Math.sign(dx) : 1;
          points[i].x -= sign * push;
          points[j].x += sign * push;
        }
      }
    }
    if (!moved) break;
  }

  bodies.forEach((body, i) => {
    result.set(body.id, { x: center.x + points[i].x, y: center.y + points[i].y });
  });
  return result;
}
