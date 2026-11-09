import type { Node as DbNode, Edge as DbEdge } from '@/types/database';
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';
import { UNLINKED, type CommunityResult } from './communities';
import { computeForceLayout, DEFAULT_FORCE_LAYOUT_OPTIONS } from './forceLayout';

export type MapViewMode = 'overview' | 'focused';

/** How the overview is laid out (the focused view always uses hop rings). */
export type OverviewLayout = 'grouped' | 'network' | 'islands' | 'original' | 'timeline';
export const OVERVIEW_LAYOUTS: OverviewLayout[] = ['original', 'timeline', 'grouped', 'network', 'islands'];
export const DEFAULT_OVERVIEW_LAYOUT: OverviewLayout = 'original';
/** Layouts that draw community outlines. */
export const OUTLINED_LAYOUTS: ReadonlySet<OverviewLayout> = new Set(['grouped', 'islands', 'timeline']);

export function isOverviewLayout(value: unknown): value is OverviewLayout {
  return typeof value === 'string' && (OVERVIEW_LAYOUTS as string[]).includes(value);
}
export type MapNodeRole = 'overview' | 'selected' | 'first-hop' | 'second-hop';

export interface FocusedGraph {
  selectedNodeId: number;
  firstHopIds: number[];
  secondHopIds: number[];
  nodeIds: Set<number>;
}

export interface RahNodeData {
  label: string;
  edgeCount: number;
  dbNode: DbNode;
  role: MapNodeRole;
  connectionCount: number;
  prominence: number;
  /** Community index for colouring (0 = largest), UNLINKED, or null when ungrouped. */
  group: number | null;
  [key: string]: unknown;
}

export interface RahGroupData {
  label: string;
  /** Community index (0 = largest) or UNLINKED. */
  index: number;
  memberCount: number;
  /** Smoothed hull outline relative to the node's top-left corner (see groupHull). */
  path: string;
  [key: string]: unknown;
}

export const GROUP_PALETTE_SIZE = 8;

/** CSS custom property holding a group's colour (see map-styles.css). */
export function groupColorVar(index: number): string {
  return index === UNLINKED
    ? 'var(--rah-map-group-unlinked)'
    : `var(--rah-map-group-${index % GROUP_PALETTE_SIZE})`;
}

export const NODE_LIMIT = 200;
export const NODE_Z_INDEX = 20;
export const FIRST_HOP_LIMIT = 10;
export const SECOND_HOP_LIMIT = 18;

type Point = { x: number; y: number };

export function buildAdjacency(dbEdges: DbEdge[]): Map<number, Set<number>> {
  const adjacency = new Map<number, Set<number>>();

  for (const edge of dbEdges) {
    if (!adjacency.has(edge.from_node_id)) adjacency.set(edge.from_node_id, new Set());
    if (!adjacency.has(edge.to_node_id)) adjacency.set(edge.to_node_id, new Set());
    adjacency.get(edge.from_node_id)?.add(edge.to_node_id);
    adjacency.get(edge.to_node_id)?.add(edge.from_node_id);
  }

  return adjacency;
}

export function buildDegreeMap(dbEdges: DbEdge[]): Map<number, number> {
  const adjacency = buildAdjacency(dbEdges);
  const degreeMap = new Map<number, number>();

  adjacency.forEach((neighbours, nodeId) => {
    degreeMap.set(nodeId, neighbours.size);
  });

  return degreeMap;
}

export function buildFocusedGraph(
  selectedNodeId: number,
  adjacency: Map<number, Set<number>>,
  degreeMap: Map<number, number>,
): FocusedGraph {
  const directNeighbours = [...(adjacency.get(selectedNodeId) ?? [])]
    .sort((a, b) => {
      const degreeDiff = (degreeMap.get(b) ?? 0) - (degreeMap.get(a) ?? 0);
      return degreeDiff !== 0 ? degreeDiff : a - b;
    })
    .slice(0, FIRST_HOP_LIMIT);

  const firstHopSet = new Set(directNeighbours);
  const secondHopScores = new Map<number, { sharedCount: number; degree: number }>();

  for (const firstHopId of directNeighbours) {
    for (const candidateId of adjacency.get(firstHopId) ?? []) {
      if (candidateId === selectedNodeId || firstHopSet.has(candidateId)) continue;

      const existing = secondHopScores.get(candidateId) ?? {
        sharedCount: 0,
        degree: degreeMap.get(candidateId) ?? 0,
      };

      existing.sharedCount += 1;
      secondHopScores.set(candidateId, existing);
    }
  }

  const secondHopIds = [...secondHopScores.entries()]
    .sort((a, b) => {
      const sharedDiff = b[1].sharedCount - a[1].sharedCount;
      if (sharedDiff !== 0) return sharedDiff;

      const degreeDiff = b[1].degree - a[1].degree;
      return degreeDiff !== 0 ? degreeDiff : a[0] - b[0];
    })
    .slice(0, SECOND_HOP_LIMIT)
    .map(([nodeId]) => nodeId);

  return {
    selectedNodeId,
    firstHopIds: directNeighbours,
    secondHopIds,
    nodeIds: new Set([selectedNodeId, ...directNeighbours, ...secondHopIds]),
  };
}

// --- Grouped overview layout ---------------------------------------------------
// Each community gets its own region: its best-connected node at the centre and the
// rest on a sunflower (phyllotaxis) spiral, which spaces any member count evenly.
// Regions are packed around the largest one, closest-first, without overlapping.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SUNFLOWER_SPACING = 50;
// Nodes are much wider than tall, so spread the spiral horizontally.
const SUNFLOWER_X_STRETCH = 1.75;
// Halo margin around a group's outermost nodes, and the clear gap kept between halos
// (room for the halo labels).
const HALO_PADDING = 16;
const GROUP_GAP = 26;
// Rendered node box used to centre a node on its layout point (positions are top-left).
export const NODE_BOX = { width: 120, height: 32 };

export interface MapGroup {
  /** Stable React Flow id for the group's halo node. */
  id: string;
  /** Community index (0 = largest) or UNLINKED. */
  index: number;
  memberIds: string[];
  label: string;
}

function packGroupCentres(radii: number[]): Point[] {
  const centres: Point[] = [];
  radii.forEach((radius, i) => {
    if (i === 0) {
      centres.push({ x: 0, y: 0 });
      return;
    }
    const fits = (candidate: Point) => centres.every((centre, j) => (
      Math.hypot(candidate.x - centre.x, (candidate.y - centre.y) * SUNFLOWER_X_STRETCH)
        >= radius + radii[j] + GROUP_GAP
    ));
    for (let distance = radius + radii[0]; ; distance += 24) {
      // Try angles around the cluster, starting from a different side for each group
      // so the arrangement does not drift to one side.
      for (let step = 0; step < 36; step += 1) {
        const angle = i * GOLDEN_ANGLE + (step / 36) * Math.PI * 2;
        const candidate = { x: Math.cos(angle) * distance, y: (Math.sin(angle) * distance) / SUNFLOWER_X_STRETCH };
        if (fits(candidate)) {
          centres.push(candidate);
          return;
        }
      }
    }
  });
  return centres;
}

export function describeGroups(
  communities: CommunityResult,
  nodesById: Map<string, DbNode>,
  degreeMap: Map<number, number>,
): MapGroup[] {
  const byDegree = (a: string, b: string) => (
    (degreeMap.get(Number(b)) ?? 0) - (degreeMap.get(Number(a)) ?? 0) || Number(a) - Number(b)
  );
  const groups: MapGroup[] = communities.communities.map((members, index) => {
    const ordered = [...members].sort(byDegree);
    const hub = nodesById.get(ordered[0]);
    return { id: `group-${index}`, index, memberIds: ordered, label: hub?.title || 'Untitled' };
  });
  if (communities.unlinked.length > 0) {
    groups.push({
      id: 'group-unlinked',
      index: UNLINKED,
      memberIds: [...communities.unlinked].sort(byDegree),
      label: 'Unlinked',
    });
  }
  return groups;
}

/**
 * Overview layout: one connected force layout (forceLayout.ts) where communities emerge
 * from the links and a soft group gravity keeps each one together, without walls between
 * them. The packed sunflower layout below only provides a deterministic starting point.
 */
function buildForceOverviewLayout(
  groups: MapGroup[],
  adjacency: Map<number, Set<number>>,
  centerX: number,
  centerY: number,
  /** 0 gives the "Network" layout: links only, no pull toward group centroids. */
  groupGravity: number = DEFAULT_FORCE_LAYOUT_OPTIONS.groupGravity,
): Map<string, Point> {
  const seedTopLeft = buildGroupedOverviewLayout(groups, centerX, centerY);
  const ids = groups.flatMap((group) => group.memberIds);
  const visible = new Set(ids);
  // Unlinked notes are not a real community: no group pull, so they float on their own.
  const groupOf = new Map<string, number | null>();
  groups.forEach((group) => group.memberIds.forEach((id) => groupOf.set(id, group.index === UNLINKED ? null : group.index)));

  const links: Array<[string, string]> = [];
  adjacency.forEach((neighbours, nodeId) => {
    const source = String(nodeId);
    if (!visible.has(source)) return;
    neighbours.forEach((neighbourId) => {
      const target = String(neighbourId);
      if (nodeId < neighbourId && visible.has(target)) links.push([source, target]);
    });
  });

  // The force layout works on node centres; React Flow positions are top-left corners.
  const half = { x: NODE_BOX.width / 2, y: NODE_BOX.height / 2 };
  const seedCentres = new Map<string, Point>();
  seedTopLeft.forEach((point, id) => seedCentres.set(id, { x: point.x + half.x, y: point.y + half.y }));
  const centres = computeForceLayout(ids, links, groupOf, seedCentres, { x: centerX, y: centerY }, {
    ...DEFAULT_FORCE_LAYOUT_OPTIONS,
    groupGravity,
  });

  const packed = packDisconnectedComponents(centres, links);

  const positions = new Map<string, Point>();
  packed.forEach((point, id) => positions.set(id, { x: point.x - half.x, y: point.y - half.y }));
  return positions;
}

/**
 * Keep the largest connected component where the force layout put it, and move every
 * smaller disconnected piece (including lone unlinked notes) into tidy rows just below
 * it, each keeping its own shape. Without this, disconnected pieces are held only by
 * gravity and drift to the edges of the map. Works on node centres.
 */
export function packDisconnectedComponents(
  centres: Map<string, Point>,
  links: Array<[string, string]>,
  gap = 48,
): Map<string, Point> {
  const ids = [...centres.keys()];
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of links) {
    if (adjacency.has(a) && adjacency.has(b)) {
      adjacency.get(a)!.push(b);
      adjacency.get(b)!.push(a);
    }
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const component: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    components.push(component);
  }
  if (components.length <= 1) return centres;

  // Largest first; ties by first id for determinism.
  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0], undefined, { numeric: true }));
  const bounds = (component: string[]) => {
    const points = component.map((id) => centres.get(id)!);
    return {
      minX: Math.min(...points.map((p) => p.x)) - NODE_BOX.width / 2,
      maxX: Math.max(...points.map((p) => p.x)) + NODE_BOX.width / 2,
      minY: Math.min(...points.map((p) => p.y)) - NODE_BOX.height / 2,
      maxY: Math.max(...points.map((p) => p.y)) + NODE_BOX.height / 2,
    };
  };

  const result = new Map<string, Point>();
  const main = bounds(components[0]);
  components[0].forEach((id) => result.set(id, centres.get(id)!));

  // Shelf packing below the main component, wrapping at its width.
  const rowWidth = Math.max(main.maxX - main.minX, 600);
  let cursorX = main.minX;
  let rowTop = main.maxY + gap * 2;
  let rowHeight = 0;
  for (const component of components.slice(1)) {
    const box = bounds(component);
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (cursorX > main.minX && cursorX + width > main.minX + rowWidth) {
      cursorX = main.minX;
      rowTop += rowHeight + gap;
      rowHeight = 0;
    }
    const dx = cursorX - box.minX;
    const dy = rowTop - box.minY;
    component.forEach((id) => {
      const p = centres.get(id)!;
      result.set(id, { x: p.x + dx, y: p.y + dy });
    });
    cursorX += width + gap;
    rowHeight = Math.max(rowHeight, height);
  }
  return result;
}

function buildGroupedOverviewLayout(groups: MapGroup[], centerX: number, centerY: number): Map<string, Point> {
  const positions = new Map<string, Point>();
  // Radius each group's halo will need, in horizontally-stretched units: the outermost
  // sunflower node sits at SPACING * sqrt(n - 1), plus half a node and the halo padding.
  const radii = groups.map((group) => (
    SUNFLOWER_SPACING * SUNFLOWER_X_STRETCH * Math.sqrt(Math.max(group.memberIds.length - 1, 0))
      + NODE_BOX.width / 2 + HALO_PADDING
  ));
  const centres = packGroupCentres(radii);

  groups.forEach((group, groupIndex) => {
    const centre = centres[groupIndex];
    group.memberIds.forEach((id, i) => {
      const r = SUNFLOWER_SPACING * Math.sqrt(i);
      const angle = i * GOLDEN_ANGLE;
      positions.set(id, {
        x: centerX + centre.x + Math.cos(angle) * r * SUNFLOWER_X_STRETCH - NODE_BOX.width / 2,
        y: centerY + centre.y + Math.sin(angle) * r - NODE_BOX.height / 2,
      });
    });
  });
  return positions;
}

export interface GroupHull {
  /** Bounding box of the hull (top-left plus size) in flow coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Closed, smoothed SVG path relative to (x, y). */
  path: string;
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Outline that hugs a group of node boxes: the convex hull of the padded boxes with its
 * corners rounded (radius at most the padding, so no member box is ever cut). Unlike an ellipse it follows
 * the group's actual shape, so neighbouring groups can sit close without large overlaps.
 */
export function groupHull(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  padding = HALO_PADDING,
): GroupHull | null {
  if (rects.length === 0) return null;
  const corners: Point[] = rects.flatMap((rect) => [
    { x: rect.x - padding, y: rect.y - padding },
    { x: rect.x + rect.width + padding, y: rect.y - padding },
    { x: rect.x + rect.width + padding, y: rect.y + rect.height + padding },
    { x: rect.x - padding, y: rect.y + rect.height + padding },
  ]);
  const hull = convexHull(corners);
  const minX = Math.min(...hull.map((p) => p.x));
  const minY = Math.min(...hull.map((p) => p.y));
  const maxX = Math.max(...hull.map((p) => p.x));
  const maxY = Math.max(...hull.map((p) => p.y));
  const local = hull.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  const fmt = (p: Point) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  // Round each corner with a radius no larger than the padding: the curve then cuts at
  // most `padding` into the corner, so it never reaches a member's box. (Rounding through
  // edge midpoints cut deep into long, thin groups and could cross the end nodes.)
  const towards = (from: Point, to: Point, distance: number): Point => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: from.x + ((to.x - from.x) / length) * distance, y: from.y + ((to.y - from.y) / length) * distance };
  };
  const roundedCorners = local.map((vertex, i) => {
    const prev = local[(i - 1 + local.length) % local.length];
    const next = local[(i + 1) % local.length];
    const radius = Math.min(
      padding,
      Math.hypot(prev.x - vertex.x, prev.y - vertex.y) / 2,
      Math.hypot(next.x - vertex.x, next.y - vertex.y) / 2,
    );
    return { entry: towards(vertex, prev, radius), vertex, exit: towards(vertex, next, radius) };
  });
  let path = `M ${fmt(roundedCorners[0].entry)}`;
  roundedCorners.forEach((corner, i) => {
    if (i > 0) path += ` L ${fmt(corner.entry)}`;
    path += ` Q ${fmt(corner.vertex)} ${fmt(corner.exit)}`;
  });
  path += ' Z';

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, path };
}

export interface TimelineTick {
  /** Flow x of the tick line. */
  x: number;
  label: string;
}

export interface TimelineLayout {
  /** Top-left node positions. */
  positions: Map<string, Point>;
  /** Date ticks along the time axis. */
  ticks: TimelineTick[];
  /** Vertical extent of the lanes, for drawing tick lines. */
  top: number;
  height: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Created-at times in ms for nodes with a parseable date. */
export function createdAtTimes(nodes: DbNode[]): Map<string, number> {
  return new Map(nodes.flatMap((node): Array<[string, number]> => {
    const time = Date.parse(node.created_at);
    return Number.isFinite(time) ? [[String(node.id), time]] : [];
  }));
}

function timelineTicks(minTime: number, maxTime: number, toX: (time: number) => number): TimelineTick[] {
  const span = maxTime - minTime;
  const ticks: TimelineTick[] = [];
  const start = new Date(minTime);
  if (span > 120 * DAY_MS) {
    // Monthly: first of each month after the start.
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    while (cursor.getTime() <= maxTime) {
      ticks.push({
        x: toX(cursor.getTime()),
        label: cursor.toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    // Weekly for shorter spans, daily for very short ones.
    const step = span > 21 * DAY_MS ? 7 * DAY_MS : DAY_MS;
    const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) + DAY_MS;
    for (let time = first; time <= maxTime; time += step) {
      ticks.push({
        x: toX(time),
        label: new Date(time).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      });
    }
  }
  return ticks;
}

/**
 * Timeline: one horizontal lane per group (largest first, Unlinked last), with each note
 * placed left-to-right by when it was created. Notes that would overlap in a lane wrap
 * onto extra rows. Also returns date ticks for the time axis.
 */
export function computeTimelineLayout(
  groups: MapGroup[],
  createdAt: Map<string, number>,
  centerX: number,
  centerY: number,
): TimelineLayout {
  const positions = new Map<string, Point>();
  const times = [...createdAt.values()];
  if (groups.every((group) => group.memberIds.length === 0)) return { positions, ticks: [], top: centerY, height: 0 };
  // With no valid dates at all, every note falls back to the start of the timeline (and
  // still gets its own lane/row), rather than being left unplaced.
  const minTime = times.length > 0 ? Math.min(...times) : 0;
  const maxTime = times.length > 0 ? Math.max(...times) : 0;
  const span = Math.max(maxTime - minTime, 1);
  const totalNodes = groups.reduce((sum, group) => sum + group.memberIds.length, 0);
  // Wide enough that notes created on the same few days do not stack into tall columns.
  const width = Math.max(1600, totalNodes * 28);
  const left = centerX - width / 2;
  const toX = (time: number) => left + ((time - minTime) / span) * width;
  const slotWidth = NODE_BOX.width + 12;
  const rowHeight = NODE_BOX.height + 14;
  const laneGap = 56;

  const lanes: Array<{ placed: Array<{ id: string; x: number; row: number }>; rows: number }> = [];
  const ordered = [...groups].sort((a, b) => (a.index === UNLINKED ? 1 : b.index === UNLINKED ? -1 : a.index - b.index));
  for (const group of ordered) {
    const members = [...group.memberIds].sort((a, b) => (createdAt.get(a) ?? minTime) - (createdAt.get(b) ?? minTime));
    const rowEnds: number[] = [];
    const placed: Array<{ id: string; x: number; row: number }> = [];
    for (const id of members) {
      const x = toX(createdAt.get(id) ?? minTime);
      let row = rowEnds.findIndex((end) => x >= end);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(-Infinity);
      }
      rowEnds[row] = x + slotWidth;
      placed.push({ id, x, row });
    }
    lanes.push({ placed, rows: Math.max(rowEnds.length, 1) });
  }

  const height = lanes.reduce((sum, lane) => sum + lane.rows * rowHeight, 0) + laneGap * Math.max(lanes.length - 1, 0);
  const top = centerY - height / 2;
  let laneTop = top;
  for (const lane of lanes) {
    for (const { id, x, row } of lane.placed) {
      positions.set(id, { x, y: laneTop + row * rowHeight });
    }
    laneTop += lane.rows * rowHeight + laneGap;
  }
  return { positions, ticks: times.length > 0 ? timelineTicks(minTime, maxTime, toX) : [], top, height };
}

// Upstream's original overview layout (centrality rings), kept as the "Original" option.
function buildRingOverviewLayout(
  nodes: DbNode[],
  adjacency: Map<number, Set<number>>,
  degreeMap: Map<number, number>,
  centerX: number,
  centerY: number,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const sortNodesByWeight = (left: DbNode, right: DbNode) => {
    const degreeDiff = (degreeMap.get(right.id) ?? right.edge_count ?? 0) - (degreeMap.get(left.id) ?? left.edge_count ?? 0);
    return degreeDiff !== 0 ? degreeDiff : left.id - right.id;
  };

  const sortedNodes = [...nodes].sort(sortNodesByWeight);
  if (sortedNodes.length === 0) {
    return positions;
  }

  const maxDegree = Math.max(...sortedNodes.map((node) => degreeMap.get(node.id) ?? node.edge_count ?? 0), 1);
  const minRadius = 24;
  const maxRadius = Math.max(280, Math.min(520, 140 + sortedNodes.length * 2.2));
  const nodeIds = sortedNodes.map((node) => node.id);
  const state = new Map<number, { x: number; y: number; vx: number; vy: number; targetRadius: number; mass: number }>();

  sortedNodes.forEach((node, index) => {
    const degree = degreeMap.get(node.id) ?? node.edge_count ?? 0;
    const centrality = degree / maxDegree;
    const targetRadius = minRadius + (1 - centrality) * (maxRadius - minRadius);
    const angle = (index / Math.max(sortedNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;

    state.set(node.id, {
      x: centerX + Math.cos(angle) * targetRadius,
      y: centerY + Math.sin(angle) * targetRadius,
      vx: 0,
      vy: 0,
      targetRadius,
      mass: 1 + centrality * 1.8,
    });
  });

  const iterations = 140;
  for (let step = 0; step < iterations; step += 1) {
    const alpha = 1 - step / iterations;

    for (let i = 0; i < nodeIds.length; i += 1) {
      const leftId = nodeIds[i];
      const left = state.get(leftId);
      if (!left) continue;

      for (let j = i + 1; j < nodeIds.length; j += 1) {
        const rightId = nodeIds[j];
        const right = state.get(rightId);
        if (!right) continue;

        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distanceSquared = dx * dx + dy * dy + 0.01;
        const distance = Math.sqrt(distanceSquared);
        const repulsion = (2200 * alpha) / distanceSquared;
        const fx = (dx / distance) * repulsion;
        const fy = (dy / distance) * repulsion;

        left.vx -= fx / left.mass;
        left.vy -= fy / left.mass;
        right.vx += fx / right.mass;
        right.vy += fy / right.mass;
      }
    }

    sortedNodes.forEach((node) => {
      const current = state.get(node.id);
      if (!current) return;

      for (const neighbourId of adjacency.get(node.id) ?? []) {
        if (!state.has(neighbourId) || neighbourId <= node.id) continue;

        const neighbour = state.get(neighbourId);
        if (!neighbour) continue;

        const dx = neighbour.x - current.x;
        const dy = neighbour.y - current.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const desired = 70 + Math.min(
          Math.abs(current.targetRadius - neighbour.targetRadius) * 0.35 + 24,
          150,
        );
        const pull = (distance - desired) * 0.0048 * alpha;
        const fx = (dx / distance) * pull;
        const fy = (dy / distance) * pull;

        current.vx += fx;
        current.vy += fy;
        neighbour.vx -= fx;
        neighbour.vy -= fy;
      }
    });

    sortedNodes.forEach((node) => {
      const current = state.get(node.id);
      if (!current) return;

      const dx = current.x - centerX;
      const dy = current.y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const radialError = distance - current.targetRadius;
      const radialPull = radialError * 0.0075;

      current.vx -= (dx / distance) * radialPull;
      current.vy -= (dy / distance) * radialPull;

      if (current.targetRadius <= minRadius + 8) {
        current.vx += (centerX - current.x) * 0.0035;
        current.vy += (centerY - current.y) * 0.0035;
      }

      current.vx *= 0.86;
      current.vy *= 0.86;
      current.x += current.vx;
      current.y += current.vy;
    });
  }

  sortedNodes.forEach((node) => {
    const current = state.get(node.id);
    if (!current) return;
    positions.set(String(node.id), { x: current.x, y: current.y });
  });

  return positions;
}

function buildFocusedLayout(
  nodes: DbNode[],
  focusedGraph: FocusedGraph,
  adjacency: Map<number, Set<number>>,
  centerX: number,
  centerY: number,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const firstHopCount = Math.max(1, focusedGraph.firstHopIds.length);
  const firstHopRadius = Math.max(220, Math.min(320, 180 + firstHopCount * 12));

  positions.set(String(focusedGraph.selectedNodeId), { x: centerX, y: centerY });

  const firstHopAngles = new Map<number, number>();
  focusedGraph.firstHopIds.forEach((nodeId, index) => {
    const angle = (index / firstHopCount) * Math.PI * 2 - Math.PI / 2;
    firstHopAngles.set(nodeId, angle);
    positions.set(String(nodeId), {
      x: centerX + Math.cos(angle) * firstHopRadius,
      y: centerY + Math.sin(angle) * firstHopRadius,
    });
  });

  const secondHopByParent = new Map<number, number[]>();
  focusedGraph.firstHopIds.forEach((nodeId) => secondHopByParent.set(nodeId, []));

  focusedGraph.secondHopIds.forEach((nodeId) => {
    const parentId = focusedGraph.firstHopIds
      .filter((firstHopId) => adjacency.get(nodeId)?.has(firstHopId))
      .sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0))[0];

    const targetParent = parentId ?? focusedGraph.firstHopIds[0];
    const group = secondHopByParent.get(targetParent) ?? [];
    group.push(nodeId);
    secondHopByParent.set(targetParent, group);
  });

  secondHopByParent.forEach((group, parentId) => {
    const parentAngle = firstHopAngles.get(parentId) ?? -Math.PI / 2;
    group.forEach((nodeId, index) => {
      const localOffset = (index - (group.length - 1) / 2) * 0.24;
      const angle = parentAngle + localOffset;
      const radius = firstHopRadius + 150 + Math.floor(index / 4) * 30;
      positions.set(String(nodeId), {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });
  });

  nodes.forEach((node) => {
    if (!positions.has(String(node.id))) {
      positions.set(String(node.id), { x: centerX, y: centerY });
    }
  });

  return positions;
}

export function toRFNodes(params: {
  nodes: DbNode[];
  viewMode: MapViewMode;
  degreeMap: Map<number, number>;
  adjacency: Map<number, Set<number>>;
  focusedGraph: FocusedGraph | null;
  /** Groups for the overview layout and node colouring (see describeGroups). */
  groups: MapGroup[];
  /** Overview layout style; the focused view ignores it. Defaults to DEFAULT_OVERVIEW_LAYOUT. */
  overviewLayout?: OverviewLayout;
  centerX: number;
  centerY: number;
}): RFNode<RahNodeData>[] {
  const { nodes, viewMode, degreeMap, adjacency, focusedGraph, groups, centerX, centerY } = params;
  const overviewLayout = params.overviewLayout ?? DEFAULT_OVERVIEW_LAYOUT;

  // The original layout predates groups, so it shows no community colours.
  const groupOf = new Map<string, number>();
  if (overviewLayout !== 'original' || focusedGraph) {
    groups.forEach((group) => group.memberIds.forEach((id) => groupOf.set(id, group.index)));
  }

  // Only lay out groups' visible members; nodes outside any group join "Unlinked".
  const visibleGroups = () => withUngroupedAsUnlinked(groups, nodes);
  let positions: Map<string, Point>;
  if (viewMode === 'focused' && focusedGraph) {
    positions = buildFocusedLayout(nodes, focusedGraph, adjacency, centerX, centerY);
  } else {
    switch (overviewLayout) {
      case 'network':
        positions = buildForceOverviewLayout(visibleGroups(), adjacency, centerX, centerY, 0);
        break;
      case 'islands':
        positions = buildGroupedOverviewLayout(visibleGroups(), centerX, centerY);
        break;
      case 'original':
        positions = buildRingOverviewLayout(nodes, adjacency, degreeMap, centerX, centerY);
        break;
      case 'timeline':
        // Notes with unparseable dates fall back to the start of the timeline.
        positions = computeTimelineLayout(visibleGroups(), createdAtTimes(nodes), centerX, centerY).positions;
        break;
      case 'grouped':
      default:
        positions = buildForceOverviewLayout(visibleGroups(), adjacency, centerX, centerY);
        break;
    }
  }

  return nodes.map((node) => {
    const role: MapNodeRole = focusedGraph
      ? node.id === focusedGraph.selectedNodeId
        ? 'selected'
        : focusedGraph.firstHopIds.includes(node.id)
          ? 'first-hop'
          : 'second-hop'
      : 'overview';

    return {
      id: String(node.id),
      type: 'rahNode',
      // Above every edge layer (toRFEdges uses zIndex 1 and 10), so an edge's wide
      // invisible click target never covers a node and swallows clicks meant for it.
      zIndex: NODE_Z_INDEX,
      position: positions.get(String(node.id)) ?? { x: centerX, y: centerY },
      data: {
        label: node.title || 'Untitled',
        edgeCount: degreeMap.get(node.id) ?? node.edge_count ?? 0,
        dbNode: node,
        role,
        connectionCount: adjacency.get(node.id)?.size ?? 0,
        prominence: Math.min(1, (degreeMap.get(node.id) ?? node.edge_count ?? 0) / Math.max(...nodes.map((n) => degreeMap.get(n.id) ?? n.edge_count ?? 0), 1)),
        group: groupOf.get(String(node.id)) ?? null,
      },
    };
  });
}

/**
 * Restrict groups to the given nodes (dropping empty groups) and put any node that is in
 * no group into the Unlinked group, so every node gets a place in the grouped layout.
 */
export function withUngroupedAsUnlinked(groups: MapGroup[], nodes: DbNode[]): MapGroup[] {
  const visible = new Set(nodes.map((node) => String(node.id)));
  const grouped = new Set<string>();
  const result = groups
    .map((group) => ({ ...group, memberIds: group.memberIds.filter((id) => visible.has(id)) }))
    .filter((group) => group.memberIds.length > 0);
  result.forEach((group) => group.memberIds.forEach((id) => grouped.add(id)));

  const stray = nodes.map((node) => String(node.id)).filter((id) => !grouped.has(id));
  if (stray.length > 0) {
    const unlinked = result.find((group) => group.index === UNLINKED);
    if (unlinked) unlinked.memberIds.push(...stray);
    else result.push({ id: 'group-unlinked', index: UNLINKED, memberIds: stray, label: 'Unlinked' });
  }
  return result;
}

const NEUTRAL_EDGE = { stroke: '#475569', strokeWidth: 1.05, opacity: 0.2 };

function overviewEdgeStyle(source: string, target: string, groupOf?: Map<string, number>) {
  if (!groupOf) return NEUTRAL_EDGE;
  const a = groupOf.get(source);
  const b = groupOf.get(target);
  if (a !== undefined && a === b && a !== UNLINKED) {
    return { stroke: groupColorVar(a), strokeWidth: 1.25, opacity: 0.42 };
  }
  return { stroke: '#64748b', strokeWidth: 0.9, opacity: 0.14 };
}

export function toRFEdges(params: {
  dbEdges: DbEdge[];
  nodeIds: Set<string>;
  focusedGraph: FocusedGraph | null;
  /**
   * Overview only: node id -> community. Links inside a community take its colour and
   * links between communities fade back, so the group structure reads at a glance.
   */
  groupOf?: Map<string, number>;
}): RFEdge[] {
  const { dbEdges, nodeIds, focusedGraph, groupOf } = params;

  return dbEdges
    .filter((edge) => nodeIds.has(String(edge.from_node_id)) && nodeIds.has(String(edge.to_node_id)))
    .map((edge) => {
      const explanation = typeof edge.context?.explanation === 'string' ? edge.context.explanation : '';
      const touchesSelected = focusedGraph
        ? edge.from_node_id === focusedGraph.selectedNodeId || edge.to_node_id === focusedGraph.selectedNodeId
        : false;
      const touchesSecondHop = focusedGraph
        ? focusedGraph.secondHopIds.includes(edge.from_node_id) || focusedGraph.secondHopIds.includes(edge.to_node_id)
        : false;

      return {
        id: String(edge.id),
        source: String(edge.from_node_id),
        target: String(edge.to_node_id),
        type: 'rahEdge',
        animated: false,
        // Straight links for the community layouts (groupOf is only set there).
        data: { explanation, straight: Boolean(groupOf) },
        style: focusedGraph
          ? touchesSelected
            ? { stroke: 'color-mix(in srgb, var(--rah-accent-green) 55%, #94a3b8)', strokeWidth: 1.9, opacity: 0.72 }
            : touchesSecondHop
              ? { stroke: '#64748b', strokeWidth: 1.15, opacity: 0.3 }
              : { stroke: '#475569', strokeWidth: 1.05, opacity: 0.22 }
          : overviewEdgeStyle(String(edge.from_node_id), String(edge.to_node_id), groupOf),
        zIndex: touchesSelected ? 10 : 1,
      };
    });
}

/**
 * Rounded-rectangle outline around a group of node boxes, used for timeline lanes, where
 * a convex hull of a stair-stepped lane would come out as a misleading triangle.
 */
export function groupBand(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  padding = HALO_PADDING,
  radius = 14,
): GroupHull | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((rect) => rect.x)) - padding;
  const minY = Math.min(...rects.map((rect) => rect.y)) - padding;
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width)) + padding;
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height)) + padding;
  const width = maxX - minX;
  const height = maxY - minY;
  const r = Math.min(radius, width / 2, height / 2);
  const path = [
    `M ${r} 0`, `H ${width - r}`, `Q ${width} 0 ${width} ${r}`,
    `V ${height - r}`, `Q ${width} ${height} ${width - r} ${height}`,
    `H ${r}`, `Q 0 ${height} 0 ${height - r}`,
    `V ${r}`, `Q 0 0 ${r} 0`, 'Z',
  ].join(' ');
  return { x: minX, y: minY, width, height, path };
}

/**
 * Replace layout targets with positions the user dragged nodes to, so a data update
 * (for example a note being edited) does not snap dragged nodes back. Overrides for
 * nodes no longer in the layout (hidden or deleted) are pruned. Mutates both maps.
 */
export function applyDragOverrides(targets: Map<string, Point>, overrides: Map<string, Point>): void {
  overrides.forEach((position, id) => {
    if (targets.has(id)) targets.set(id, position);
    else overrides.delete(id);
  });
}

export type CameraPlan =
  | { kind: 'center'; x: number; y: number }
  | { kind: 'bounds'; x: number; y: number; width: number; height: number };

/**
 * Decide what the camera should frame. Automatic fits in the focused view centre the
 * focused note; a manual Fit (`fitAll`) always frames everything visible. Bounds use
 * full-label node sizes and include community outlines and timeline tick labels.
 * Returns null when there is nothing to frame yet (e.g. the focused note is not loaded).
 */
export function planCamera(params: {
  targets: Map<string, Point>;
  focusId: string | null;
  fitAll: boolean;
  outlineGroups: MapGroup[];
  ticks: Point[];
  nodeSize: { width: number; height: number };
}): CameraPlan | null {
  const { targets, focusId, fitAll, outlineGroups, ticks, nodeSize } = params;
  if (targets.size === 0) return null;

  if (focusId && !fitAll) {
    const focused = targets.get(focusId);
    return focused ? { kind: 'center', x: focused.x, y: focused.y } : null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number, width: number, height: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  };
  targets.forEach((position) => include(position.x, position.y, nodeSize.width, nodeSize.height));
  // Outlines extend beyond their outermost nodes; keep them (and their labels) in view.
  outlineGroups.forEach((group) => {
    const hull = groupHull(group.memberIds.flatMap((id) => {
      const position = targets.get(id);
      return position ? [{ ...position, ...NODE_BOX }] : [];
    }));
    if (hull) include(hull.x, hull.y - nodeSize.height / 2, hull.width, hull.height + nodeSize.height / 2);
  });
  // Timeline date labels sit above the top lane.
  ticks.forEach((tick) => include(tick.x - 40, tick.y, 80, nodeSize.height));
  return { kind: 'bounds', x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
