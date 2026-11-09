import type { Node as DbNode, Edge as DbEdge } from '@/types/database';
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';
import { UNLINKED, type CommunityResult } from './communities';

export type MapViewMode = 'overview' | 'focused';
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
  [key: string]: unknown;
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
const SUNFLOWER_SPACING = 58;
// Nodes are much wider than tall, so spread the spiral horizontally.
const SUNFLOWER_X_STRETCH = 1.75;
// Halo margin around a group's outermost nodes, and the clear gap kept between halos
// (room for the halo labels).
const HALO_PADDING = 16;
const GROUP_GAP = 40;
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

/**
 * Bounding box of an ellipse fitted to a group of node boxes, for drawing a group halo.
 * `rects` are top-left positions plus sizes.
 *
 * The ellipse is shaped like the spread of the node centres and scaled just enough to
 * contain every centre, then grown by half a node plus padding. For the round sunflower
 * clusters this hugs the group far more tightly than circumscribing the bounding box.
 */
export function groupHaloBounds(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  padding = HALO_PADDING,
): { x: number; y: number; width: number; height: number } | null {
  if (rects.length === 0) return null;
  const centres = rects.map((rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }));
  const minX = Math.min(...centres.map((c) => c.x));
  const maxX = Math.max(...centres.map((c) => c.x));
  const minY = Math.min(...centres.map((c) => c.y));
  const maxY = Math.max(...centres.map((c) => c.y));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Half-extents of the centres' spread (floored so 1-2 node groups still get a shape).
  const ax = Math.max((maxX - minX) / 2, 1);
  const ay = Math.max((maxY - minY) / 2, 1);
  // Smallest scale k such that every centre satisfies (dx/(k*ax))^2 + (dy/(k*ay))^2 <= 1.
  const k = Math.max(1, ...centres.map((c) => Math.hypot((c.x - cx) / ax, (c.y - cy) / ay)));
  const maxHalfWidth = Math.max(...rects.map((rect) => rect.width / 2));
  const maxHalfHeight = Math.max(...rects.map((rect) => rect.height / 2));
  const rx = k * ax + maxHalfWidth + padding;
  const ry = k * ay + maxHalfHeight + padding;
  return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
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
  centerX: number;
  centerY: number;
}): RFNode<RahNodeData>[] {
  const { nodes, viewMode, degreeMap, adjacency, focusedGraph, groups, centerX, centerY } = params;

  const groupOf = new Map<string, number>();
  groups.forEach((group) => group.memberIds.forEach((id) => groupOf.set(id, group.index)));

  const positions = viewMode === 'focused' && focusedGraph
    ? buildFocusedLayout(nodes, focusedGraph, adjacency, centerX, centerY)
    : buildGroupedOverviewLayout(
      // Only lay out groups' visible members; nodes outside any group join "Unlinked".
      withUngroupedAsUnlinked(groups, nodes),
      centerX,
      centerY,
    );

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

export function toRFEdges(params: {
  dbEdges: DbEdge[];
  nodeIds: Set<string>;
  focusedGraph: FocusedGraph | null;
}): RFEdge[] {
  const { dbEdges, nodeIds, focusedGraph } = params;

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
        data: { explanation },
        style: focusedGraph
          ? touchesSelected
            ? { stroke: 'color-mix(in srgb, var(--rah-accent-green) 55%, #94a3b8)', strokeWidth: 1.9, opacity: 0.72 }
            : touchesSecondHop
              ? { stroke: '#64748b', strokeWidth: 1.15, opacity: 0.3 }
              : { stroke: '#475569', strokeWidth: 1.05, opacity: 0.22 }
          : { stroke: '#475569', strokeWidth: 1.05, opacity: 0.2 },
        zIndex: touchesSelected ? 10 : 1,
      };
    });
}
