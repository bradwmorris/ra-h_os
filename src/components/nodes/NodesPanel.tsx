"use client";

import { useState, useEffect, useRef, type DragEvent } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Layers, List, Maximize2, Minimize2 } from 'lucide-react';
import { Node } from '@/types/database';
import AddNodeButton from './AddNodeButton';
import Chip from '../common/Chip';
import { getNodeIcon } from '@/utils/nodeIcons';
import SearchModal from './SearchModal';

interface NodesPanelProps {
  selectedNodes: Set<number>;
  onNodeSelect: (nodeId: number, multiSelect: boolean) => void;
  onNodeCreated?: (node: Node) => void;
  onNodeDeleted?: (nodeId: number) => void;
  refreshTrigger?: number;
  onToggleFolderView?: (isOpen?: boolean) => void;
  folderViewOpen?: boolean;
}

interface LockedDimension {
  dimension: string;
  count: number;
  isPriority: boolean;
}


export default function NodesPanel({ selectedNodes, onNodeSelect, onNodeCreated, onNodeDeleted, refreshTrigger, onToggleFolderView, folderViewOpen = false }: NodesPanelProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [allNodes, setAllNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingNode, setDeletingNode] = useState<number | null>(null);
  const [priorityDimensions, setPriorityDimensions] = useState<string[]>([]);
  const [lockedDimensions, setLockedDimensions] = useState<LockedDimension[]>([]);
  const [expandedDimensions, setExpandedDimensions] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    const saved = window.localStorage.getItem('expandedDimensions');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [dimensionNodes, setDimensionNodes] = useState<Record<string, Node[]>>({});
  const [selectedFilters, setSelectedFilters] = useState<{type: 'dimension' | 'title', value: string}[]>([]);
  const [dimensionsSectionCollapsed, setDimensionsSectionCollapsed] = useState(true); // Default: collapsed
  const [allNodesSectionCollapsed, setAllNodesSectionCollapsed] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [dropFeedback, setDropFeedback] = useState<string | null>(null);
  const [dragHoverDimension, setDragHoverDimension] = useState<string | null>(null);
  const draggedNodeRef = useRef<{ id: number; dimensions?: string[] } | null>(null);

  useEffect(() => {
    fetchNodes();
    fetchLockedDimensions();
  }, []);

  // Save expanded dimensions to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('expandedDimensions', JSON.stringify([...expandedDimensions]));
  }, [expandedDimensions]);

  // Refresh nodes and locked dimensions when SSE events trigger updates
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      console.log('🔄 Refreshing nodes and locked dimensions due to SSE event');
      fetchNodes();
      fetchLockedDimensions();
    }
  }, [refreshTrigger]);

  // Global Cmd+K / Ctrl+K keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearchModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Re-apply filters when allNodes changes
  useEffect(() => {
    if (selectedFilters.length > 0) {
      applyFiltersWithSelection(selectedFilters);
    } else {
      setNodes(allNodes);
    }
  }, [allNodes, priorityDimensions]);

  const fetchNodes = async () => {
    try {
      const response = await fetch('/api/nodes?limit=100');
      const result = await response.json();
      const fetchedNodes = result.data || [];
      setAllNodes(fetchedNodes);
      setNodes(fetchedNodes);
    } catch (error) {
      console.error('Error fetching nodes:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLockedDimensions = async () => {
    try {
      const response = await fetch('/api/dimensions/popular');
      const result = await response.json();
      if (result.success) {
        const locked = result.data.filter((d: any) => d.isPriority);
        setLockedDimensions(locked);
        const priority = locked.map((d: any) => d.dimension);
        setPriorityDimensions(priority);
      }
    } catch (error) {
      console.error('Error fetching locked dimensions:', error);
    }
  };

  const toggleDimension = async (dimension: string) => {
    const isCurrentlyExpanded = expandedDimensions.has(dimension);
    
    setExpandedDimensions(prev => {
      const next = new Set(prev);
      if (next.has(dimension)) {
        next.delete(dimension);
      } else {
        next.add(dimension);
      }
      return next;
    });

    // Fetch nodes for this dimension when expanding (if not already fetched)
    if (!isCurrentlyExpanded && !dimensionNodes[dimension]) {
      await fetchNodesForDimension(dimension);
    }
  };

  const fetchNodesForDimension = async (dimension: string) => {
    try {
      // Sort by edge count (most connected first), then updated_at
      const response = await fetch(`/api/nodes?dimensions=${encodeURIComponent(dimension)}&limit=200&sortBy=edges`);
      const result = await response.json();
      if (result.success) {
        setDimensionNodes(prev => ({
          ...prev,
          [dimension]: result.data || []
        }));
      }
    } catch (error) {
      console.error(`Error fetching nodes for dimension ${dimension}:`, error);
    }
  };

  const handleDimensionDragOver = (event: DragEvent<HTMLElement>) => {
    if (event.dataTransfer.types.includes('application/node-info') || event.dataTransfer.types.includes('text/plain')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDimensionDragEnter = (event: DragEvent<HTMLElement>, dimension: string) => {
    if (event.dataTransfer.types.includes('application/node-info') || event.dataTransfer.types.includes('text/plain')) {
      setDragHoverDimension(dimension);
    }
  };

  const handleDimensionDragLeave = (event: DragEvent<HTMLElement>, dimension: string) => {
    if (dragHoverDimension === dimension) {
      setDragHoverDimension(null);
    }
  };

  const handleNodeDropOnDimension = async (event: DragEvent<HTMLElement>, dimension: string) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Try to get data from ref first (works in Electron/Tauri webviews)
    let payload: { id: number; dimensions?: string[] } | null = draggedNodeRef.current;
    
    // Fallback to dataTransfer for browser compatibility
    if (!payload) {
      const raw = event.dataTransfer.getData('application/node-info') || event.dataTransfer.getData('text/plain');
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch (e) {
          console.error('Failed to parse drag data:', e);
        }
      }
    }
    
    // Clear the ref
    draggedNodeRef.current = null;
    
    if (!payload?.id) {
      console.warn('No valid node data in drop event');
      return;
    }

    try {
      const currentDimensions = payload.dimensions || [];
      if (currentDimensions.some((dim) => dim.toLowerCase() === dimension.toLowerCase())) {
        setDropFeedback(`Node already in ${dimension}`);
        setTimeout(() => setDropFeedback(null), 2500);
        return;
      }

      const updatedDimensions = Array.from(new Set([...currentDimensions, dimension]));
      const response = await fetch(`/api/nodes/${payload.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimensions: updatedDimensions })
      });

      if (!response.ok) {
        throw new Error('Failed to update node dimensions');
      }

      setDropFeedback(`Added to ${dimension}`);
      setTimeout(() => setDropFeedback(null), 2500);
      if (expandedDimensions.has(dimension)) {
        fetchNodesForDimension(dimension);
      }
      fetchLockedDimensions();
      setDragHoverDimension(null);
    } catch (error) {
      console.error('Error handling node drop:', error);
      setDropFeedback('Failed to add dimension');
      setTimeout(() => setDropFeedback(null), 2500);
      setDragHoverDimension(null);
    }
  };

  const getNodesForDimension = (dimension: string): Node[] => {
    // Use fetched dimension-specific nodes if available, otherwise filter from loaded nodes
    return dimensionNodes[dimension] || nodes.filter(node => 
      node.dimensions?.some(d => d.toLowerCase() === dimension.toLowerCase())
    );
  };

  const applyFilters = () => {
    if (selectedFilters.length === 0) {
      setNodes(allNodes);
      return;
    }

    const dimensionFilters = selectedFilters.filter(f => f.type === 'dimension').map(f => f.value);
    const titleFilters = selectedFilters.filter(f => f.type === 'title').map(f => f.value);

    const filtered = allNodes.filter(node => {
      // Must match ALL selected dimension filters
      const dimensionMatch = dimensionFilters.length === 0 || 
        dimensionFilters.every(dim => 
          node.dimensions?.some(nodeDim => nodeDim.toLowerCase() === dim.toLowerCase())
        );
      
      // Must match ANY selected title filter
      const titleMatch = titleFilters.length === 0 ||
        titleFilters.some(title => 
          node.title?.toLowerCase().includes(title.toLowerCase())
        );
      
      return dimensionMatch && titleMatch;
    });

    // Sort by priority dimensions first
    const sorted = filtered.sort((a, b) => {
      const aHasPriority = a.dimensions?.some(dim => priorityDimensions.includes(dim)) || false;
      const bHasPriority = b.dimensions?.some(dim => priorityDimensions.includes(dim)) || false;
      if (aHasPriority && !bHasPriority) return -1;
      if (!aHasPriority && bHasPriority) return 1;
      return 0;
    });

    setNodes(sorted);
  };

  const addFilter = (type: 'dimension' | 'title', value: string) => {
    const newFilter = { type, value };
    const newFilters = [...selectedFilters, newFilter];
    setSelectedFilters(newFilters);
    
    // Apply filters immediately
    setTimeout(() => {
      if (newFilters.length === 0) {
        setNodes(allNodes);
      } else {
        applyFiltersWithSelection(newFilters);
      }
    }, 0);
  };

  const removeFilter = (index: number) => {
    const newFilters = selectedFilters.filter((_, i) => i !== index);
    setSelectedFilters(newFilters);
    
    // Apply filters immediately
    setTimeout(() => {
      if (newFilters.length === 0) {
        setNodes(allNodes);
      } else {
        applyFiltersWithSelection(newFilters);
      }
    }, 0);
  };

  const applyFiltersWithSelection = async (filters: {type: 'dimension' | 'title', value: string}[]) => {
    const dimensionFilters = filters.filter(f => f.type === 'dimension').map(f => f.value);
    const titleFilters = filters.filter(f => f.type === 'title').map(f => f.value);

    try {
      // Build API query params
      const params = new URLSearchParams();
      
      if (dimensionFilters.length > 0) {
        params.append('dimensions', dimensionFilters.join(','));
      }
      
      if (titleFilters.length > 0) {
        // For title filters, we'll search each one and combine results
        const titleResults: Node[] = [];
        
        for (const title of titleFilters) {
          const response = await fetch(`/api/nodes?search=${encodeURIComponent(title)}&limit=50`);
          const result = await response.json();
          if (result.success) {
            titleResults.push(...result.data);
          }
        }
        
        // If we have dimension filters too, intersect the results
        if (dimensionFilters.length > 0) {
          const dimensionResponse = await fetch(`/api/nodes?${params.toString()}&limit=200`);
          const dimensionResult = await dimensionResponse.json();
          
          if (dimensionResult.success) {
            // Find intersection: nodes that match dimensions AND titles
            const dimensionNodeIds = new Set(dimensionResult.data.map((n: Node) => n.id));
            const intersectedNodes = titleResults.filter(node => dimensionNodeIds.has(node.id));
            setNodes(intersectedNodes);
          }
        } else {
          // Only title filters
          setNodes(titleResults);
        }
      } else if (dimensionFilters.length > 0) {
        // Only dimension filters
        const response = await fetch(`/api/nodes?${params.toString()}&limit=200`);
        const result = await response.json();
        
        if (result.success) {
          setNodes(result.data);
        }
      }
    } catch (error) {
      console.error('Error applying filters:', error);
      // Fallback to local filtering
      const filtered = allNodes.filter(node => {
        const dimensionMatch = dimensionFilters.length === 0 || 
          dimensionFilters.every(dim => 
            node.dimensions?.some(nodeDim => nodeDim.toLowerCase() === dim.toLowerCase())
          );
        
        const titleMatch = titleFilters.length === 0 ||
          titleFilters.some(title => 
            node.title?.toLowerCase().includes(title.toLowerCase())
          );
        
        return dimensionMatch && titleMatch;
      });
      setNodes(filtered);
    }
  };

  const clearSearch = () => {
    setSelectedFilters([]);
    setNodes(allNodes);
  };

  const collapseAllDimensions = () => {
    setExpandedDimensions(new Set());
  };

  const handleNodeDragStart = (event: DragEvent<HTMLElement>, node: Node) => {
    event.dataTransfer.effectAllowed = 'copy';
    const nodeData = {
      id: node.id,
      dimensions: node.dimensions || []
    };
    // Store in ref for webview compatibility (dataTransfer.getData can fail in Electron/Tauri)
    draggedNodeRef.current = nodeData;
    // Also set in dataTransfer for browser compatibility
    event.dataTransfer.setData('application/node-info', JSON.stringify(nodeData));
    event.dataTransfer.setData('text/plain', JSON.stringify(nodeData));

    const preview = document.createElement('div');
    preview.textContent = node.title || `Node #${node.id}`;
    preview.style.position = 'fixed';
    preview.style.top = '-1000px';
    preview.style.left = '-1000px';
    preview.style.padding = '4px 8px';
    preview.style.background = '#0f0f0f';
    preview.style.color = '#f8fafc';
    preview.style.fontSize = '11px';
    preview.style.fontWeight = '600';
    preview.style.borderRadius = '6px';
    preview.style.border = '1px solid #1f1f1f';
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 6, 6);
    setTimeout(() => {
      if (preview.parentNode) {
        preview.parentNode.removeChild(preview);
      }
    }, 0);
  };

  const handleNodeDragEnd = () => {
    // Clear ref if drag ends without a drop
    draggedNodeRef.current = null;
  };

  const renderNodeItem = (node: Node) => (
    <button
      key={node.id}
      draggable
      onDragStart={(event) => handleNodeDragStart(event, node)}
      onDragEnd={handleNodeDragEnd}
      onClick={(e) => {
        const multiSelect = e.metaKey || e.ctrlKey;
        onNodeSelect(node.id, multiSelect);
      }}
      style={{
        width: '100%',
        padding: '8px 16px',
        margin: '0',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '14px',
        fontFamily: 'inherit',
        background: selectedNodes.has(node.id) ? '#1a1a1a' : 'transparent',
        color: selectedNodes.has(node.id) ? '#fff' : '#d1d5db',
        border: 'none',
        cursor: 'pointer',
        transition: 'background 0.1s',
        whiteSpace: 'nowrap',
        overflow: 'hidden'
      }}
      onMouseEnter={(e) => {
        if (!selectedNodes.has(node.id)) {
          e.currentTarget.style.background = '#0a0a0a';
        }
      }}
      onMouseLeave={(e) => {
        if (!selectedNodes.has(node.id)) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      {/* Node ID Badge */}
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#22c55e',
        color: '#0a0a0a',
        fontSize: '9px',
        fontWeight: 600,
        padding: '1px 5px',
        borderRadius: '3px',
        flexShrink: 0,
        fontFamily: 'monospace',
        lineHeight: 1,
        height: '16px'
      }}>
        #{node.id}
      </span>
      
      {/* Title */}
      <span style={{ 
        overflow: 'hidden', 
        textOverflow: 'ellipsis',
        flex: 1
      }}>
        {node.title || 'Untitled'}
      </span>

      {/* Source Icon - Only show if node has a link */}
      {node.link && (
        <span style={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          marginLeft: '8px'
        }}>
          {getNodeIcon(node)}
        </span>
      )}

    </button>
  );

  const handleAddNode = async () => {
    setCreating(true);
    try {
      const response = await fetch('/api/nodes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'New Node',
          content: '',
          link: null,
          dimensions: []
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Add new node to both lists immediately
        setAllNodes(prevNodes => [result.data, ...prevNodes]);
        setNodes(prevNodes => [result.data, ...prevNodes]);
        
        // Notify parent component about new node creation
        if (onNodeCreated) {
          onNodeCreated(result.data);
        }
      } else {
        console.error('Failed to create node:', result.message);
      }
    } catch (error) {
      console.error('Error creating node:', error);
    } finally {
      setCreating(false);
    }
  };

  // handleDeleteNode removed - deletion only available in focus panel

  const handleNodeSelectFromSearch = (nodeId: number) => {
    // Open node in focus panel without filtering the nodes panel
    onNodeSelect(nodeId, false);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
      {/* Search Modal */}
      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        onNodeSelect={handleNodeSelectFromSearch}
        existingFilters={selectedFilters}
      />

      {/* Nodes List */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '8px 0'
      }}>
        {loading ? (
          <div style={{ 
            padding: '16px', 
            color: '#666', 
            fontSize: '14px' 
          }}>
            Loading nodes...
          </div>
        ) : (
          <div>
            {/* + ADD NODE Button & folder expand */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px' }}>
              <button
                onClick={handleAddNode}
                disabled={creating}
                style={{
                  flex: 1,
                  padding: '12px 12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#22c55e',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  borderBottom: '1px solid #1a1a1a',
                  background: 'transparent',
                  border: 'none',
                  cursor: creating ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (!creating) {
                    e.currentTarget.style.background = '#151515';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#0a0a0a';
                }}
              >
                <span style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: '#22c55e',
                  color: '#0a0a0a',
                  fontSize: '16px',
                  lineHeight: 1,
                  fontWeight: 300,
                  flexShrink: 0
                }}>+</span>
                {creating ? 'Adding...' : 'Add Node'}
              </button>
              <button
                onClick={() => onToggleFolderView?.()}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  border: '1px solid #1f1f1f',
                  background: 'transparent',
                  color: '#666',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title={folderViewOpen ? 'Close dimension folder view' : 'Open dimension folder view'}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#1a1a1a';
                  e.currentTarget.style.color = '#999';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#666';
                }}
              >
                {folderViewOpen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>

            {dropFeedback && (
              <div style={{
                margin: '6px 8px 0',
                padding: '6px 10px',
                borderRadius: '6px',
                background: '#0d1a12',
                color: '#7de8a5',
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {dropFeedback}
              </div>
            )}

            {/* SEARCH Button */}
            <button
              onClick={() => setShowSearchModal(true)}
              style={{
                width: '100%',
                padding: '12px 16px',
                margin: '4px 8px', /* Added side margins */
                fontSize: '11px',
                fontWeight: 600,
                color: '#555',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                borderRadius: '4px', /* Added border radius */
                background: 'transparent', /* Transparent to show panel color */
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#151515';
                e.currentTarget.style.color = '#777';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#0a0a0a';
                e.currentTarget.style.color = '#555';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
                </svg>
                Search
              </div>
              <span style={{ fontSize: '9px', color: '#444', fontWeight: 400 }}>⌘K</span>
            </button>

            {/* DIMENSIONS Section Header */}
            {lockedDimensions.length > 0 && (
              <button
                onClick={() => setDimensionsSectionCollapsed(!dimensionsSectionCollapsed)}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: dimensionsSectionCollapsed ? '#94a3b8' : '#f8fafc',
                  letterSpacing: '0.01em',
                borderBottom: '1px solid #151515',
                borderLeft: '3px solid transparent',
                  background: dimensionsSectionCollapsed ? '#050505' : '#0e1811',
                  borderTop: '1px solid #000',
                  borderRight: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Layers size={14} color={dimensionsSectionCollapsed ? '#94a3b8' : '#f8fafc'} />
                  <span>Dimensions</span>
                </div>
                {dimensionsSectionCollapsed ? (
                  <ChevronRight size={14} strokeWidth={2.5} color="#94a3b8" />
                ) : (
                  <ChevronDown size={14} strokeWidth={2.5} color="#f8fafc" />
                )}
              </button>
            )}

            {/* Locked Dimension Sections */}
            {!dimensionsSectionCollapsed && lockedDimensions.map((lockedDim) => {
              const dimNodes = getNodesForDimension(lockedDim.dimension);
              const isExpanded = expandedDimensions.has(lockedDim.dimension);
              
              return (
                <div key={lockedDim.dimension} style={{ marginBottom: '4px' }}>
                  {/* Dimension Header */}
                  <button
                    onClick={() => toggleDimension(lockedDim.dimension)}
                    onDragOver={(e) => handleDimensionDragOver(e)}
                    onDragEnter={(e) => handleDimensionDragEnter(e, lockedDim.dimension)}
                    onDragLeave={(e) => handleDimensionDragLeave(e, lockedDim.dimension)}
                    onDrop={(e) => handleNodeDropOnDimension(e, lockedDim.dimension)}
                    style={{
                      width: '100%',
                      padding: '10px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: dragHoverDimension === lockedDim.dimension ? '#152214' : (isExpanded ? '#0d0d0d' : '#050505'),
                      border: dragHoverDimension === lockedDim.dimension ? '1px solid #1f3d28' : 'none',
                      borderBottom: dragHoverDimension === lockedDim.dimension ? '1px solid #1f3d28' : '1px solid #121212',
                      borderLeft: '2px solid transparent',
                      color: '#cbd5f5',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                      {isExpanded ? (
                        <FolderOpen size={16} color="#7de8a5" />
                      ) : (
                        <Folder size={16} color="#64748b" />
                      )}
                      <span>
                        {lockedDim.dimension}
                      </span>
                    </div>
                    <span
                      style={{
                        minWidth: '32px',
                        textAlign: 'right',
                        fontSize: '11px',
                        color: '#94a3b8',
                        fontWeight: 500,
                        background: '#0f1a12',
                        borderRadius: '999px',
                        padding: '2px 8px'
                      }}
                    >
                      {lockedDim.count}
                    </span>
                  </button>
                  
                  {/* Dimension Nodes (when expanded) */}
                  {isExpanded && (
                    <div>
                      {dimNodes.length === 0 ? (
                        <div style={{
                          padding: '12px 16px',
                          color: '#555',
                          fontSize: '12px',
                          fontStyle: 'italic'
                        }}>
                          No nodes in this dimension
                        </div>
                      ) : (
                        dimNodes.map((node) => renderNodeItem(node))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* ALL NODES Section Header */}
            <button
              onClick={() => setAllNodesSectionCollapsed(!allNodesSectionCollapsed)}
              style={{
                width: '100%',
                padding: '14px 18px',
                fontSize: '14px',
                fontWeight: 600,
                color: allNodesSectionCollapsed ? '#94a3b8' : '#f8fafc',
                letterSpacing: '0.01em',
                borderBottom: '1px solid #151515',
                borderLeft: '3px solid transparent',
                background: allNodesSectionCollapsed ? '#050505' : '#0e1811',
                borderTop: '1px solid #000',
                borderRight: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <List size={14} color={allNodesSectionCollapsed ? '#94a3b8' : '#f8fafc'} />
                <span>Nodes</span>
              </div>
              {allNodesSectionCollapsed ? (
                <ChevronRight size={14} strokeWidth={2.5} color="#94a3b8" />
              ) : (
                <ChevronDown size={14} strokeWidth={2.5} color="#f8fafc" />
              )}
            </button>
            
            {/* All Nodes List */}
            {!allNodesSectionCollapsed && (
              nodes.length === 0 ? (
                <div style={{ 
                  padding: '16px', 
                  color: '#666', 
                  fontSize: '14px',
                  textAlign: 'center'
                }}>
                  {selectedFilters.length > 0 ? 'No nodes match filters' : 'No nodes yet - click "Add Node" above to get started'}
                </div>
              ) : (
                nodes.map((node) => renderNodeItem(node))
              )
            )}
          </div>
        )}
      </div>

    </div>
  );
}
