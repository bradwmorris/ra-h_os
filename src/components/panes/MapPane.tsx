"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
  type OnNodeDrag,
  type Node as RFNode,
  type Edge as RFEdge,
  ReactFlowProvider,
  useReactFlow,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Edge as DbEdge, Node as DbNode } from '@/types/database';
import { Boxes, CircleDot, LayoutGrid, ListStart, Network } from 'lucide-react';
import PaneHeader from './PaneHeader';
import { SegmentedControl, type SegmentedOption } from '@/components/common/SegmentedControl';
import type { MapPaneProps } from './types';
import { RahNode } from './map/RahNode';
import { RahGroup } from './map/RahGroup';
import { RahTick, type RahTickData } from './map/RahTick';
import { RahEdge } from './map/RahEdge';
import {
  buildAdjacency,
  buildDegreeMap,
  buildFocusedGraph,
  describeGroups,
  groupBand,
  groupHull,
  computeTimelineLayout,
  createdAtTimes,
  toRFNodes,
  toRFEdges,
  withUngroupedAsUnlinked,
  applyDragOverrides,
  planCamera,
  NODE_BOX,
  NODE_LIMIT,
  type MapGroup,
  type OverviewLayout,
  isOverviewLayout,
  DEFAULT_OVERVIEW_LAYOUT,
  OUTLINED_LAYOUTS,
  type MapViewMode,
  type RahGroupData,
  type RahNodeData,
} from './map/utils';
import { detectCommunities, UNLINKED } from './map/communities';
import { useSpringLayout } from './map/useSpringLayout';
import { CompactBelowZoomContext, FIT_LABEL_MARGIN } from './map/labelZoom';
import type { Point } from './map/springLayout';
import { useTheme } from '@/hooks/useTheme';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { usePersistentState } from '@/hooks/usePersistentState';
import './map/map-styles.css';

type RahFlowNode = RFNode<RahNodeData, 'rahNode'>;
type GroupFlowNode = RFNode<RahGroupData, 'rahGroup'>;
type TickFlowNode = RFNode<RahTickData, 'rahTick'>;
type MapFlowNode = RahFlowNode | GroupFlowNode | TickFlowNode;

/** Decorations drawn behind the graph: group outlines and (timeline) date ticks. */
interface MapOverlay {
  groups: MapGroup[];
  /** Rounded-rectangle lanes instead of hulls (timeline). */
  bands: boolean;
  ticks: TickFlowNode[];
}

const EMPTY_OVERLAY: MapOverlay = { groups: [], bands: false, ticks: [] };

const nodeTypes = { rahNode: RahNode, rahGroup: RahGroup, rahTick: RahTick };
const OVERVIEW_LAYOUT_KEY = 'ui.map.overviewLayout.v1';
const LAYOUT_OPTIONS: Array<SegmentedOption<OverviewLayout>> = [
  { value: 'original', label: 'Original', icon: <CircleDot size={13} />, title: 'Original: most-linked notes in the centre' },
  { value: 'timeline', label: 'Timeline', icon: <ListStart size={13} />, title: 'Timeline: notes by creation date, one row per topic' },
  { value: 'grouped', label: 'Grouped', icon: <Boxes size={13} />, title: 'Grouped: topics pulled together, with links between them' },
  { value: 'network', label: 'Network', icon: <Network size={13} />, title: 'Network: pure link structure, no grouping' },
  { value: 'islands', label: 'Islands', icon: <LayoutGrid size={13} />, title: 'Islands: each topic in its own region' },
];

// Communities smaller than this get a colour accent but no halo, to avoid clutter.
const MIN_HALO_MEMBERS = 3;

function isRahNode(node: MapFlowNode): node is RahFlowNode {
  return node.type === 'rahNode';
}

/**
 * Rebuild the group halo nodes around the current node positions. Halos come first in
 * the array and sit at zIndex -1 so they render behind the graph.
 */
function withGroupHalos(nodes: MapFlowNode[], overlay: MapOverlay): MapFlowNode[] {
  const { groups, bands, ticks } = overlay;
  const rahNodes = nodes.filter(isRahNode);
  if (groups.length === 0) return [...ticks, ...rahNodes];

  const byId = new Map(rahNodes.map((node) => [node.id, node]));
  const halos: GroupFlowNode[] = [];
  for (const group of groups) {
    const rects = group.memberIds.flatMap((id) => {
      const node = byId.get(id);
      return node
        ? [{
          x: node.position.x,
          y: node.position.y,
          width: node.measured?.width ?? NODE_BOX.width,
          height: node.measured?.height ?? NODE_BOX.height,
        }]
        : [];
    });
    const hull = bands ? groupBand(rects) : groupHull(rects);
    if (!hull) continue;
    halos.push({
      id: group.id,
      type: 'rahGroup',
      position: { x: hull.x, y: hull.y },
      width: hull.width,
      height: hull.height,
      data: { label: group.label, index: group.index, memberCount: rects.length, path: hull.path },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    });
  }
  return [...ticks, ...halos, ...rahNodes];
}
const edgeTypes = { rahEdge: RahEdge };

const SEARCH_MIN_CHARS = 2;
const SEARCH_RESULT_LIMIT = 8;

const LAYOUT_CENTER_X = 640;
const LAYOUT_CENTER_Y = 420;
// Node positions are their top-left corner; pad camera bounds by the largest rendered
// node size (map-styles.css caps .rah-map-node at 168px wide) so labels stay in view.
const NODE_MAX_WIDTH = 168;
const NODE_APPROX_HEIGHT = 36;
// Low enough that the widest layout (Timeline, ~28px per note) still fits a narrow pane.
const MIN_ZOOM = 0.03;
// Below this pane width the layout switcher shows icons only (labels stay as tooltips).
const NARROW_PANE_WIDTH = 900;
// Moves under this many pixels count as a click (focus the node), not a drag.
const NODE_DRAG_THRESHOLD = 4;

function MapPaneInner({
  slot,
  onCollapse,
  onSwapPanes,
  tabBar,
  onNodeClick,
  focusedNodeId,
  onClearFocus,
}: MapPaneProps) {
  const reactFlowInstance = useReactFlow();
  const [theme] = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  // Track the pane's width so the toolbar can compact itself in two-/three-pane layouts.
  const paneRef = useRef<HTMLDivElement>(null);
  const [narrowPane, setNarrowPane] = useState(false);
  useEffect(() => {
    const element = paneRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setNarrowPane(entry.contentRect.width < NARROW_PANE_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Labels show at the fitted (default) zoom and above; set after each camera fit.
  const [compactBelowZoom, setCompactBelowZoom] = useState(0);
  const rememberFittedZoom = useCallback(() => {
    setCompactBelowZoom(reactFlowInstance.getZoom() * FIT_LABEL_MARGIN);
  }, [reactFlowInstance]);
  const [storedLayout, setOverviewLayout] = usePersistentState<OverviewLayout>(OVERVIEW_LAYOUT_KEY, DEFAULT_OVERVIEW_LAYOUT);
  // Guard against stale or hand-edited storage values.
  const overviewLayout: OverviewLayout = isOverviewLayout(storedLayout) ? storedLayout : DEFAULT_OVERVIEW_LAYOUT;

  const [baseNodes, setBaseNodes] = useState<DbNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<DbNode[]>([]);
  const [dbEdges, setDbEdges] = useState<DbEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: number; title: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<MapFlowNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);

  const allDbNodes = useMemo(() => {
    const baseIds = new Set(baseNodes.map((node) => node.id));
    return [...baseNodes, ...expandedNodes.filter((node) => !baseIds.has(node.id))];
  }, [baseNodes, expandedNodes]);

  const nodesById = useMemo(() => {
    const map = new Map<number, DbNode>();
    allDbNodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [allDbNodes]);

  const adjacency = useMemo(() => buildAdjacency(dbEdges), [dbEdges]);
  const degreeMap = useMemo(() => buildDegreeMap(dbEdges), [dbEdges]);

  const focusedGraph = useMemo(
    () => (selectedNodeId ? buildFocusedGraph(selectedNodeId, adjacency, degreeMap) : null),
    [selectedNodeId, adjacency, degreeMap],
  );

  const viewMode: MapViewMode = focusedGraph ? 'focused' : 'overview';

  const visibleNodes = useMemo(() => {
    if (!focusedGraph) {
      return [...baseNodes]
        .sort((a, b) => (degreeMap.get(b.id) ?? b.edge_count ?? 0) - (degreeMap.get(a.id) ?? a.edge_count ?? 0))
        .slice(0, NODE_LIMIT);
    }

    return [...focusedGraph.nodeIds]
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is DbNode => Boolean(node))
      .sort((a, b) => {
        const roleWeight = a.id === focusedGraph.selectedNodeId
          ? 0
          : focusedGraph.firstHopIds.includes(a.id)
            ? 1
            : 2;
        const otherRoleWeight = b.id === focusedGraph.selectedNodeId
          ? 0
          : focusedGraph.firstHopIds.includes(b.id)
            ? 1
            : 2;

        if (roleWeight !== otherRoleWeight) return roleWeight - otherRoleWeight;

        const degreeDiff = (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0);
        return degreeDiff !== 0 ? degreeDiff : a.id - b.id;
      });
  }, [baseNodes, degreeMap, focusedGraph, nodesById]);

  const hoveredDbNode = hoveredNodeId ? nodesById.get(hoveredNodeId) ?? null : null;

  // Hovering a node highlights its neighbourhood: everything else is dimmed (applied as a
  // class on the rendered copies, so the simulation's node state is untouched).
  const hoverNeighbourhood = useMemo(() => {
    if (hoveredNodeId === null) return null;
    const ids = new Set<string>([String(hoveredNodeId)]);
    adjacency.get(hoveredNodeId)?.forEach((id) => ids.add(String(id)));
    return ids;
  }, [adjacency, hoveredNodeId]);

  const displayNodes = useMemo(() => {
    if (!hoverNeighbourhood) return rfNodes;
    return rfNodes.map((node) => (
      isRahNode(node) && !hoverNeighbourhood.has(node.id) ? { ...node, className: 'rah-map-dimmed' } : node
    ));
  }, [hoverNeighbourhood, rfNodes]);

  const displayEdges = useMemo(() => {
    if (hoveredNodeId === null) return rfEdges;
    const hovered = String(hoveredNodeId);
    return rfEdges.map((edge) => (
      edge.source === hovered || edge.target === hovered ? edge : { ...edge, className: 'rah-map-dimmed' }
    ));
  }, [hoveredNodeId, rfEdges]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [nodesRes, edgesRes] = await Promise.all([
          fetch(`/api/nodes?limit=${NODE_LIMIT}&sortBy=edges`),
          fetch('/api/edges'),
        ]);

        if (!nodesRes.ok || !edgesRes.ok) {
          throw new Error('Failed to load map data');
        }

        const nodesPayload = await nodesRes.json();
        const edgesPayload = await edgesRes.json();

        setBaseNodes(nodesPayload.data || []);
        setDbEdges(edgesPayload.data || []);
        setExpandedNodes([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, []);

  // Communities (groups of densely linked nodes) are detected on the overview set, so a
  // node keeps its group colour when the view switches to focused mode.
  const groups = useMemo(() => {
    const ids = baseNodes.map((node) => String(node.id));
    const links = dbEdges.map((edge): [string, string] => [String(edge.from_node_id), String(edge.to_node_id)]);
    const byId = new Map(baseNodes.map((node) => [String(node.id), node]));
    return describeGroups(detectCommunities(ids, links), byId, degreeMap);
  }, [baseNodes, dbEdges, degreeMap]);

  // Outlines are drawn in the overview only (and only for layouts that use them); the
  // focused view keeps its hop rings.
  const haloGroups = useMemo(
    () => (viewMode === 'overview' && OUTLINED_LAYOUTS.has(overviewLayout)
      ? withUngroupedAsUnlinked(groups, visibleNodes)
        // Unlinked notes are not a community, so they get no outline.
        .filter((group) => group.memberIds.length >= MIN_HALO_MEMBERS && group.index !== UNLINKED)
      : []),
    [groups, overviewLayout, viewMode, visibleNodes],
  );
  // Timeline date axis (ticks with guide lines through the lanes).
  const timelineTicks = useMemo((): TickFlowNode[] => {
    if (viewMode !== 'overview' || overviewLayout !== 'timeline') return [];
    const timeline = computeTimelineLayout(
      withUngroupedAsUnlinked(groups, visibleNodes),
      createdAtTimes(visibleNodes),
      LAYOUT_CENTER_X,
      LAYOUT_CENTER_Y,
    );
    const axisGap = 48;
    return timeline.ticks.map((tick, i) => ({
      id: `tick-${i}`,
      type: 'rahTick' as const,
      position: { x: tick.x, y: timeline.top - axisGap },
      data: { label: tick.label, lineHeight: timeline.height + axisGap - 20 },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -2,
    }));
  }, [groups, overviewLayout, viewMode, visibleNodes]);

  const overlay = useMemo((): MapOverlay => ({
    groups: haloGroups,
    bands: overviewLayout === 'timeline',
    ticks: timelineTicks,
  }), [haloGroups, overviewLayout, timelineTicks]);
  const overlayRef = useRef<MapOverlay>(EMPTY_OVERLAY);
  const dragOverridesRef = useRef(new Map<string, Point>());
  const viewKeyRef = useRef('');

  // Target layout: where each node should come to rest for the current view.
  const layoutNodes = useMemo(
    () => toRFNodes({
      nodes: visibleNodes,
      viewMode,
      degreeMap,
      adjacency,
      focusedGraph,
      groups,
      overviewLayout,
      centerX: LAYOUT_CENTER_X,
      centerY: LAYOUT_CENTER_Y,
    }),
    [adjacency, degreeMap, focusedGraph, groups, overviewLayout, viewMode, visibleNodes],
  );

  // Group-coloured links in the overview layouts that show communities (not Original,
  // which predates groups, and not the focused view, which highlights hops instead).
  const edgeGroupOf = useMemo(() => {
    if (viewMode !== 'overview' || overviewLayout === 'original') return undefined;
    const map = new Map<string, number>();
    groups.forEach((group) => group.memberIds.forEach((id) => map.set(id, group.index)));
    return map;
  }, [groups, overviewLayout, viewMode]);

  const layoutEdges = useMemo(
    () => toRFEdges({
      dbEdges,
      nodeIds: new Set(visibleNodes.map((node) => String(node.id))),
      focusedGraph,
      groupOf: edgeGroupOf,
    }),
    [dbEdges, edgeGroupOf, focusedGraph, visibleNodes],
  );

  // The spring simulation animates rendered positions toward the target layout. Only
  // positions are patched per frame; other node fields (React Flow's measured size,
  // selection) are preserved.
  const applyAnimatedPositions = useCallback((positions: Map<string, Point>) => {
    setRfNodes((prev) => withGroupHalos(
      prev.map((node) => {
        if (!isRahNode(node)) return node;
        const position = positions.get(node.id);
        if (!position || (position.x === node.position.x && position.y === node.position.y)) return node;
        return { ...node, position };
      }),
      overlayRef.current,
    ));
  }, [setRfNodes]);

  const springLayout = useSpringLayout({ onFrame: applyAnimatedPositions, reducedMotion });

  useEffect(() => {
    // Positions the user dragged nodes to survive data updates (e.g. a note being edited)
    // and are dropped only when the view itself changes: layout, overview/focused, or
    // which node is focused.
    const viewKey = `${viewMode}:${overviewLayout}:${focusedGraph?.selectedNodeId ?? ''}`;
    if (viewKeyRef.current !== viewKey) {
      dragOverridesRef.current.clear();
      viewKeyRef.current = viewKey;
    }
    const targets = new Map<string, Point>(layoutNodes.map((node) => [node.id, node.position]));
    applyDragOverrides(targets, dragOverridesRef.current);
    const links = layoutEdges.map((edge): [string, string] => [edge.source, edge.target]);
    overlayRef.current = overlay;
    const start = springLayout.retarget(targets, links);

    setRfNodes((prev) => {
      const previousById = new Map(prev.filter(isRahNode).map((node) => [node.id, node]));
      const nextNodes: RahFlowNode[] = layoutNodes.map((node) => ({
        ...previousById.get(node.id),
        ...node,
        type: 'rahNode' as const,
        position: start.get(node.id) ?? node.position,
      }));
      return withGroupHalos(nextNodes, overlay);
    });
    setRfEdges(layoutEdges);
  }, [focusedGraph, layoutEdges, layoutNodes, overlay, overviewLayout, setRfEdges, setRfNodes, springLayout, viewMode]);

  useEffect(() => {
    if (!focusedGraph) {
      return;
    }

    const missingIds = [...focusedGraph.nodeIds].filter((nodeId) => !nodesById.has(nodeId));
    if (missingIds.length === 0) return;

    void (async () => {
      const fetched = (
        await Promise.all(
          missingIds.map(async (nodeId) => {
            try {
              const response = await fetch(`/api/nodes/${nodeId}`);
              if (!response.ok) return null;
              const payload = await response.json();
              return payload.node as DbNode;
            } catch {
              return null;
            }
          }),
        )
      ).filter((node): node is DbNode => node !== null);

      if (fetched.length === 0) return;

      setExpandedNodes((prev) => {
        const existingIds = new Set(prev.map((node) => node.id));
        const fresh = fetched.filter((node) => !existingIds.has(node.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    })();
  }, [focusedGraph, nodesById]);

  useEffect(() => {
    if (focusedNodeId == null) {
      setSelectedNodeId(null);
      return;
    }

    if (selectedNodeId === focusedNodeId) return;

    const existing = nodesById.get(focusedNodeId);
    if (existing) {
      setSelectedNodeId(focusedNodeId);
      return;
    }

    void (async () => {
      try {
        const response = await fetch(`/api/nodes/${focusedNodeId}`);
        if (!response.ok) return;

        const payload = await response.json();
        const node = payload.node as DbNode | undefined;
        if (!node) return;

        setExpandedNodes((prev) => (prev.some((existingNode) => existingNode.id === node.id) ? prev : [...prev, node]));
        setSelectedNodeId(node.id);
      } catch (err) {
        console.error('Failed to fetch focused node for map:', err);
      }
    })();
  }, [focusedNodeId, nodesById]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        setSearchLoading(true);
        try {
          const response = await fetch(`/api/nodes/search?q=${encodeURIComponent(trimmed)}&limit=${SEARCH_RESULT_LIMIT}`);
          if (!response.ok) {
            setSearchResults([]);
            return;
          }

          const payload = await response.json();
          setSearchResults(payload.data || []);
        } catch {
          setSearchResults([]);
        } finally {
          setSearchLoading(false);
        }
      })();
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  // Camera framing. Fits the TARGET layout with any dragged positions applied, not the
  // rendered positions (still mid-animation after a view change), and sizes every node for
  // its full label, so labels that expand after the fit still fit. Returns false when
  // there is nothing to frame yet (e.g. the focused note has not loaded).
  const fitCamera = useCallback((fitAll = false): boolean => {
    const targets = new Map<string, Point>(layoutNodes.map((node) => [node.id, node.position]));
    dragOverridesRef.current.forEach((position, id) => {
      if (targets.has(id)) targets.set(id, position);
    });
    const plan = planCamera({
      targets,
      focusId: focusedGraph && selectedNodeId ? String(selectedNodeId) : null,
      fitAll,
      outlineGroups: haloGroups,
      ticks: timelineTicks.map((tick) => tick.position),
      nodeSize: { width: NODE_MAX_WIDTH, height: NODE_APPROX_HEIGHT },
    });
    if (!plan) return false;

    const duration = reducedMotion ? 0 : 420;
    if (plan.kind === 'center') {
      void reactFlowInstance.setCenter(plan.x, plan.y, { duration, zoom: 1.02 }).then(rememberFittedZoom);
    } else {
      void reactFlowInstance.fitBounds(
        { x: plan.x, y: plan.y, width: plan.width, height: plan.height },
        { padding: 0.18, duration },
      ).then(rememberFittedZoom);
    }
    return true;
  }, [focusedGraph, haloGroups, layoutNodes, reactFlowInstance, reducedMotion, rememberFittedZoom, selectedNodeId, timelineTicks]);

  // Refit automatically only when the view changes (layout, overview/focused, focused
  // note) or on first load, not on every data update: live updates and note edits should
  // neither move the camera nor frame away from nodes the user dragged.
  const fittedViewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading || layoutNodes.length === 0) return;
    const viewKey = `${viewMode}:${overviewLayout}:${selectedNodeId ?? ''}`;
    if (fittedViewKeyRef.current === viewKey) return;

    const timeout = window.setTimeout(() => {
      if (fitCamera()) fittedViewKeyRef.current = viewKey;
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [fitCamera, layoutNodes, loading, overviewLayout, selectedNodeId, viewMode]);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource('/api/events');

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          switch (payload.type) {
            case 'NODE_CREATED': {
              // Quick-add broadcasts a placeholder without an id; the real node follows.
              const node = payload.data?.node as DbNode | undefined;
              if (!node?.id) break;
              // The overview holds the NODE_LIMIT best-connected notes; a brand-new note
              // has no links yet, so it only joins while there is room.
              setBaseNodes((prev) => (
                prev.some((existing) => existing.id === node.id) || prev.length >= NODE_LIMIT
                  ? prev
                  : [...prev, node]
              ));
              break;
            }
            case 'NODE_UPDATED': {
              const node = payload.data?.node as DbNode | undefined;
              if (!node?.id) break;

              const updateNodes = (prev: DbNode[]) =>
                prev.map((existingNode) => (existingNode.id === node.id ? { ...existingNode, ...node } : existingNode));

              setBaseNodes(updateNodes);
              setExpandedNodes(updateNodes);
              break;
            }
            case 'NODE_DELETED': {
              const deletedId = payload.data?.nodeId as number | undefined;
              if (!deletedId) break;

              setBaseNodes((prev) => prev.filter((node) => node.id !== deletedId));
              setExpandedNodes((prev) => prev.filter((node) => node.id !== deletedId));
              setDbEdges((prev) => prev.filter((edge) => edge.from_node_id !== deletedId && edge.to_node_id !== deletedId));
              setSelectedNodeId((prev) => (prev === deletedId ? null : prev));
              if (deletedId === focusedNodeId) {
                onClearFocus?.();
              }
              break;
            }
            case 'EDGE_CREATED': {
              const edge = payload.data?.edge as DbEdge | undefined;
              if (!edge?.id) break;
              setDbEdges((prev) => (prev.some((existingEdge) => existingEdge.id === edge.id) ? prev : [...prev, edge]));
              break;
            }
            case 'EDGE_DELETED': {
              const edgeId = payload.data?.edgeId as number | undefined;
              if (!edgeId) break;
              setDbEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
              break;
            }
            default:
              break;
          }
        } catch {
          // Ignore keep-alives and malformed payloads.
        }
      };

      eventSource.onerror = () => {
        console.error('Map SSE connection error');
      };
    } catch {
      console.error('Failed to establish Map SSE connection');
    }

    return () => {
      eventSource?.close();
    };
  }, [focusedNodeId, onClearFocus]);

  const resetToOverview = useCallback(() => {
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    onClearFocus?.();
  }, [onClearFocus]);

  const handleSearchSelect = useCallback(async (nodeId: number) => {
    const existing = nodesById.get(nodeId);
    if (!existing) {
      try {
        const response = await fetch(`/api/nodes/${nodeId}`);
        if (response.ok) {
          const payload = await response.json();
          const node = payload.node as DbNode | undefined;
          if (node) {
            setExpandedNodes((prev) => (prev.some((existingNode) => existingNode.id === node.id) ? prev : [...prev, node]));
          }
        }
      } catch (err) {
        console.error('Failed to fetch search-selected node:', err);
      }
    }

    setSelectedNodeId(nodeId);
    setSearchOpen(false);
    setSearchQuery('');
    onNodeClick?.(nodeId);
  }, [nodesById, onNodeClick]);

  const handleNodeClickHandler: NodeMouseHandler<MapFlowNode> = useCallback((_event, node) => {
    if (!isRahNode(node)) return;
    const nodeId = parseInt(node.id, 10);
    if (!Number.isNaN(nodeId)) {
      setSelectedNodeId(nodeId);
      onNodeClick?.(nodeId);
    }
  }, [onNodeClick]);

  const handleNodeMouseEnter: NodeMouseHandler<MapFlowNode> = useCallback((_event, node) => {
    if (!isRahNode(node)) return;
    const nodeId = parseInt(node.id, 10);
    if (!Number.isNaN(nodeId)) {
      setHoveredNodeId(nodeId);
    }
  }, []);

  const handleNodeMouseLeave: NodeMouseHandler<MapFlowNode> = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // Dragging holds the node under the pointer; linked neighbours follow on their springs.
  // On release the node keeps its new place and the neighbours settle back.
  // React Flow drags every selected node together and passes them all in `nodes`.
  const handleNodeDrag: OnNodeDrag<MapFlowNode> = useCallback((_event, node, nodes) => {
    (nodes.length > 0 ? nodes : [node]).filter(isRahNode).forEach((dragged) => {
      springLayout.pin(dragged.id, dragged.position);
    });
  }, [springLayout]);

  const handleNodeDragStop: OnNodeDrag<MapFlowNode> = useCallback((_event, node, nodes) => {
    (nodes.length > 0 ? nodes : [node]).filter(isRahNode).forEach((dragged) => {
      springLayout.pin(dragged.id, dragged.position);
      springLayout.release(dragged.id);
      dragOverridesRef.current.set(dragged.id, { ...dragged.position });
    });
  }, [springLayout]);

  // Manual Fit frames everything visible, in the overview and the focused view alike
  // (automatic focus changes centre the focused note instead).
  const fitVisibleNodes = useCallback(() => {
    fitCamera(true);
  }, [fitCamera]);

  return (
    <div ref={paneRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent', overflow: 'hidden' }}>
      <PaneHeader slot={slot} onCollapse={onCollapse} onSwapPanes={onSwapPanes} tabBar={tabBar}>
        <div style={headerTools}>
          <span style={viewMode === 'focused' ? focusedBadge : overviewBadge}>
            {viewMode === 'focused' ? 'Focused' : 'Overview'}
          </span>

          {viewMode === 'overview' ? (
            <SegmentedControl
              ariaLabel="Map layout"
              options={LAYOUT_OPTIONS}
              value={overviewLayout}
              onChange={setOverviewLayout}
              iconOnly={narrowPane}
            />
          ) : null}

          <div style={searchShell}>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search nodes..."
              style={searchInput}
            />

            {searchOpen && (searchQuery.trim().length >= SEARCH_MIN_CHARS || searchResults.length > 0) && (
              <div style={searchResultsPanel}>
                {searchLoading ? (
                  <div style={searchHint}>Searching…</div>
                ) : searchResults.length === 0 ? (
                  <div style={searchHint}>No matching nodes</div>
                ) : (
                  searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void handleSearchSelect(result.id)}
                      style={searchResultButton}
                    >
                      <span style={searchResultTitle}>{result.title || 'Untitled'}</span>
                      <span style={searchResultMeta}>#{result.id}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </PaneHeader>

      <div style={{ position: 'relative', flex: 1, background: 'var(--rah-bg-base)' }}>
        {loading ? (
          <div style={emptyState}>Loading map…</div>
        ) : error ? (
          <div style={{ ...emptyState, color: '#ef4444' }}>{error}</div>
        ) : rfNodes.length === 0 ? (
          <div style={emptyState}>No nodes to display</div>
        ) : (
          <div className="rah-map-wrapper" style={{ width: '100%', height: '100%' }}>
            <CompactBelowZoomContext.Provider value={compactBelowZoom}>
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClickHandler}
              onNodeMouseEnter={handleNodeMouseEnter}
              onNodeMouseLeave={handleNodeMouseLeave}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              minZoom={MIN_ZOOM}
              maxZoom={2.5}
              onNodeDragStart={handleNodeDrag}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              nodesDraggable
              nodeDragThreshold={NODE_DRAG_THRESHOLD}
              nodesConnectable={false}
              elementsSelectable
              selectNodesOnDrag={false}
              defaultEdgeOptions={{ type: 'rahEdge' }}
              proOptions={{ hideAttribution: true }}
              colorMode={theme}
            >
              <Background color="var(--rah-border)" gap={40} size={1} />
              <MiniMap
                style={{ background: 'var(--rah-bg-panel)', border: '1px solid var(--rah-border)', borderRadius: 6 }}
                maskColor={theme === 'light' ? 'rgba(255, 255, 255, 0.72)' : 'rgba(0, 0, 0, 0.7)'}
                nodeColor={(node) => {
                  if (node.type === 'rahGroup' || node.type === 'rahTick') return 'transparent';
                  const data = node.data as RahNodeData | undefined;
                  switch (data?.role) {
                    case 'selected':
                      return '#16a34a';
                    case 'first-hop':
                      return '#22c55e';
                    case 'second-hop':
                      return '#94a3b8';
                    default:
                      return '#64748b';
                  }
                }}
                pannable
                zoomable
              />
            </ReactFlow>
            </CompactBelowZoomContext.Provider>

            <div style={floatingActions}>
              <button type="button" onClick={fitVisibleNodes} style={floatingButton} title="Fit visible nodes">
                Fit
              </button>
              {selectedNodeId ? (
                <button type="button" onClick={resetToOverview} style={floatingButton} title="Return to overview">
                  Overview
                </button>
              ) : null}
            </div>

            {hoveredDbNode && hoveredNodeId !== selectedNodeId ? (
              <div style={hoverPreviewCard}>
                <div style={hoverPreviewTitle}>{hoveredDbNode.title || 'Untitled'}</div>
                {hoveredDbNode.description ? (
                  <div style={hoverPreviewBody}>{hoveredDbNode.description}</div>
                ) : (
                  <div style={hoverPreviewMeta}>No description</div>
                )}
              </div>
            ) : null}

          </div>
        )}
      </div>
    </div>
  );
}

export default function MapPane(props: MapPaneProps) {
  return (
    <ReactFlowProvider>
      <MapPaneInner {...props} />
    </ReactFlowProvider>
  );
}

const emptyState: CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--rah-text-muted)',
};

const headerTools: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  minWidth: 0,
};

const overviewBadge: CSSProperties = {
  padding: '5px 9px',
  borderRadius: 999,
  border: '1px solid var(--rah-border-strong)',
  background: 'var(--rah-bg-panel)',
  color: 'var(--rah-text-muted)',
  fontSize: 11,
  fontWeight: 600,
};

const focusedBadge: CSSProperties = {
  ...overviewBadge,
  borderColor: 'var(--rah-accent-green-soft-strong)',
  background: 'var(--rah-accent-green-soft)',
  color: 'var(--rah-accent-green)',
};

const searchShell: CSSProperties = {
  position: 'relative',
  flex: '0 1 220px',
  minWidth: 120,
};

const searchInput: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--rah-border-strong)',
  background: 'var(--rah-bg-panel)',
  color: 'var(--rah-text-base)',
  fontSize: 12,
  outline: 'none',
};

const searchResultsPanel: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  right: 0,
  background: 'var(--rah-bg-modal)',
  border: '1px solid var(--rah-border)',
  borderRadius: 10,
  boxShadow: 'var(--rah-shadow-floating)',
  overflow: 'hidden',
  zIndex: 30,
};

const searchHint: CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  color: 'var(--rah-text-muted)',
};

const searchResultButton: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '10px 12px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--rah-text-base)',
  textAlign: 'left',
};

const searchResultTitle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
};

const searchResultMeta: CSSProperties = {
  fontSize: 11,
  color: 'var(--rah-text-muted)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
};

const floatingActions: CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  display: 'flex',
  gap: 6,
  zIndex: 10,
};

const floatingButton: CSSProperties = {
  padding: '5px 9px',
  fontSize: 11,
  background: 'var(--rah-bg-panel)',
  border: '1px solid var(--rah-border-strong)',
  borderRadius: 6,
  color: 'var(--rah-text-muted)',
  cursor: 'pointer',
};

const hoverPreviewCard: CSSProperties = {
  position: 'absolute',
  top: 14,
  left: 14,
  width: 260,
  padding: 12,
  borderRadius: 10,
  background: 'var(--rah-bg-modal)',
  border: '1px solid var(--rah-border)',
  boxShadow: 'var(--rah-shadow-floating)',
  zIndex: 12,
};

const hoverPreviewTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--rah-text-base)',
  marginBottom: 6,
};

const hoverPreviewBody: CSSProperties = {
  fontSize: 12,
  color: 'var(--rah-text-muted)',
  lineHeight: 1.45,
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const hoverPreviewMeta: CSSProperties = {
  fontSize: 12,
  color: 'var(--rah-text-muted)',
};
