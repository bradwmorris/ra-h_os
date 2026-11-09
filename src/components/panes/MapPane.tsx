"use client";

import { useEffect, useMemo, useState, useCallback, type CSSProperties } from 'react';
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
import PaneHeader from './PaneHeader';
import type { MapPaneProps } from './types';
import { RahNode } from './map/RahNode';
import { RahEdge } from './map/RahEdge';
import {
  buildAdjacency,
  buildDegreeMap,
  buildFocusedGraph,
  toRFNodes,
  toRFEdges,
  NODE_LIMIT,
  type MapViewMode,
  type RahNodeData,
} from './map/utils';
import { useSpringLayout } from './map/useSpringLayout';
import type { Point } from './map/springLayout';
import { useTheme } from '@/hooks/useTheme';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import './map/map-styles.css';

const nodeTypes = { rahNode: RahNode };
const edgeTypes = { rahEdge: RahEdge };

const SEARCH_MIN_CHARS = 2;
const SEARCH_RESULT_LIMIT = 8;

const LAYOUT_CENTER_X = 640;
const LAYOUT_CENTER_Y = 420;
// Node positions are their top-left corner; pad camera bounds by the largest rendered
// node size (map-styles.css caps .rah-map-node at 168px wide) so labels stay in view.
const NODE_MAX_WIDTH = 168;
const NODE_APPROX_HEIGHT = 36;
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

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode<RahNodeData>>([]);
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

  // Target layout: where each node should come to rest for the current view.
  const layoutNodes = useMemo(
    () => toRFNodes({
      nodes: visibleNodes,
      viewMode,
      degreeMap,
      adjacency,
      focusedGraph,
      centerX: LAYOUT_CENTER_X,
      centerY: LAYOUT_CENTER_Y,
    }),
    [adjacency, degreeMap, focusedGraph, viewMode, visibleNodes],
  );

  const layoutEdges = useMemo(
    () => toRFEdges({
      dbEdges,
      nodeIds: new Set(visibleNodes.map((node) => String(node.id))),
      focusedGraph,
    }),
    [dbEdges, focusedGraph, visibleNodes],
  );

  // The spring simulation animates rendered positions toward the target layout. Only
  // positions are patched per frame; other node fields (React Flow's measured size,
  // selection) are preserved.
  const applyAnimatedPositions = useCallback((positions: Map<string, Point>) => {
    setRfNodes((prev) => prev.map((node) => {
      const position = positions.get(node.id);
      if (!position || (position.x === node.position.x && position.y === node.position.y)) return node;
      return { ...node, position };
    }));
  }, [setRfNodes]);

  const springLayout = useSpringLayout({ onFrame: applyAnimatedPositions, reducedMotion });

  useEffect(() => {
    const targets = new Map<string, Point>(layoutNodes.map((node) => [node.id, node.position]));
    const links = layoutEdges.map((edge): [string, string] => [edge.source, edge.target]);
    const start = springLayout.retarget(targets, links);

    setRfNodes((prev) => {
      const previousById = new Map(prev.map((node) => [node.id, node]));
      return layoutNodes.map((node) => ({
        ...previousById.get(node.id),
        ...node,
        position: start.get(node.id) ?? node.position,
      }));
    });
    setRfEdges(layoutEdges);
  }, [layoutEdges, layoutNodes, setRfEdges, setRfNodes, springLayout]);

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

  // Frame the camera on the TARGET layout, not the rendered positions, which are still
  // mid-animation when the view changes.
  useEffect(() => {
    if (loading || layoutNodes.length === 0) return;

    const timeout = window.setTimeout(() => {
      if (focusedGraph && selectedNodeId) {
        const selectedNode = layoutNodes.find((node) => node.id === String(selectedNodeId));
        if (selectedNode) {
          reactFlowInstance.setCenter(selectedNode.position.x, selectedNode.position.y, {
            duration: reducedMotion ? 0 : 420,
            zoom: 1.02,
          });
        }
        return;
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      layoutNodes.forEach(({ position }) => {
        minX = Math.min(minX, position.x);
        minY = Math.min(minY, position.y);
        maxX = Math.max(maxX, position.x + NODE_MAX_WIDTH);
        maxY = Math.max(maxY, position.y + NODE_APPROX_HEIGHT);
      });
      reactFlowInstance.fitBounds(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        { padding: 0.18, duration: reducedMotion ? 0 : 420 },
      );
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [focusedGraph, layoutNodes, loading, reactFlowInstance, reducedMotion, selectedNodeId]);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource('/api/events');

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          switch (payload.type) {
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

  const handleNodeClickHandler: NodeMouseHandler<RFNode<RahNodeData>> = useCallback((_event, node) => {
    const nodeId = parseInt(node.id, 10);
    if (!Number.isNaN(nodeId)) {
      setSelectedNodeId(nodeId);
      onNodeClick?.(nodeId);
    }
  }, [onNodeClick]);

  const handleNodeMouseEnter: NodeMouseHandler<RFNode<RahNodeData>> = useCallback((_event, node) => {
    const nodeId = parseInt(node.id, 10);
    if (!Number.isNaN(nodeId)) {
      setHoveredNodeId(nodeId);
    }
  }, []);

  const handleNodeMouseLeave: NodeMouseHandler<RFNode<RahNodeData>> = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // Dragging holds the node under the pointer; linked neighbours follow on their springs.
  // On release the node keeps its new place and the neighbours settle back.
  const handleNodeDrag: OnNodeDrag<RFNode<RahNodeData>> = useCallback((_event, node) => {
    springLayout.pin(node.id, node.position);
  }, [springLayout]);

  const handleNodeDragStop: OnNodeDrag<RFNode<RahNodeData>> = useCallback((_event, node) => {
    springLayout.pin(node.id, node.position);
    springLayout.release(node.id);
  }, [springLayout]);

  const fitVisibleNodes = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.2, duration: 260 });
  }, [reactFlowInstance]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent', overflow: 'hidden' }}>
      <PaneHeader slot={slot} onCollapse={onCollapse} onSwapPanes={onSwapPanes} tabBar={tabBar}>
        <div style={headerTools}>
          <span style={viewMode === 'focused' ? focusedBadge : overviewBadge}>
            {viewMode === 'focused' ? 'Focused' : 'Overview'}
          </span>

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
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClickHandler}
              onNodeMouseEnter={handleNodeMouseEnter}
              onNodeMouseLeave={handleNodeMouseLeave}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              minZoom={0.12}
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
  gap: 10,
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
  width: 220,
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
