"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import NodesPanel from '../nodes/NodesPanel';
import FocusPanel from '../focus/FocusPanel';
import AgentsPanel from '../agents/AgentsPanel';
import SettingsCog from '../settings/SettingsCog';
import SettingsModal, { SettingsTab } from '../settings/SettingsModal';
import { Node } from '@/types/database';
import { DatabaseEvent } from '@/services/events';
import { usePersistentState } from '@/hooks/usePersistentState';
import FolderViewOverlay from '../nodes/FolderViewOverlay';
import { Maximize2 } from 'lucide-react';

export default function ThreePanelLayout() {
  // Panel widths as percentages (20% | 40% | 40%)
  const [leftWidth, setLeftWidth] = useState(20);
  const [middleWidth, setMiddleWidth] = useState(40);
  
  // Collapsible state for nodes panel
  const [nodesCollapsed, setNodesCollapsed] = usePersistentState('ui.nodesCollapsed', false);

  // Collapsible state for chat/agents panel
  const [chatCollapsed, setChatCollapsed] = usePersistentState('ui.chatCollapsed', false);
  
  // Settings dropdown state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>();
  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsInitialTab(undefined);
  }, []);
  // Dragging states
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track selected nodes and open tabs
  const [selectedNodes, setSelectedNodes] = useState<Set<number>>(new Set<number>());
  const [openTabs, setOpenTabs] = usePersistentState<number[]>('ui.focus.openTabs', []);
  const [activeTab, setActiveTab] = usePersistentState<number | null>('ui.focus.activeTab', null);
  const [openTabsData, setOpenTabsData] = useState<Node[]>([]);
  
  // Event handlers for SSE events
  const [nodesPanelRefresh, setNodesPanelRefresh] = useState(0);
  const [focusPanelRefresh, setFocusPanelRefresh] = useState(0);
  const [folderViewOpen, setFolderViewOpen] = useState(false);
  const [folderViewRefresh, setFolderViewRefresh] = useState(0);
  
  // Ref to get current openTabs value in SSE handler
  const openTabsRef = useRef<number[]>([]);

  // Fetch full node data for open tabs
  const fetchOpenTabsData = async (tabIds: number[]) => {
    if (tabIds.length === 0) {
      setOpenTabsData([]);
      return;
    }

    try {
      const nodePromises = tabIds.map(async (id) => {
        const response = await fetch(`/api/nodes/${id}`);
        if (response.ok) {
          const data = await response.json();
          return data.node as Node;
        }
        return null;
      });

      const nodes = await Promise.all(nodePromises);
      const validNodes = nodes.filter((node): node is Node => Boolean(node)).map(node => ({
        id: node.id,
        title: node.title,
        link: node.link,
        content: node.content,
        dimensions: node.dimensions,
        created_at: node.created_at,
        updated_at: node.updated_at
      }));
      setOpenTabsData(validNodes);
    } catch (error) {
      console.error('Failed to fetch tab data:', error);
      setOpenTabsData([]);
    }
  };

  // Update tab data whenever openTabs changes
  useEffect(() => {
    openTabsRef.current = openTabs; // Keep ref updated
    fetchOpenTabsData(openTabs);
  }, [openTabs]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+1 (Mac) or Ctrl+1 (Windows/Linux) - toggle nodes panel
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault();
        setNodesCollapsed(prev => !prev);
      }
      // Check for Cmd+\ (Mac) or Ctrl+\ (Windows/Linux) - toggle chat panel
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setChatCollapsed(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setNodesCollapsed, setChatCollapsed]);


  // SSE connection for real-time updates
  useEffect(() => {
    let eventSource: EventSource | null = null;
    
    try {
      eventSource = new EventSource('/api/events');
      
      eventSource.onopen = () => {
        console.log('🔌 SSE connected for real-time updates');
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data: DatabaseEvent = JSON.parse(event.data);
          
          switch (data.type) {
            case 'NODE_CREATED':
              // Trigger NodesPanel refresh
              setNodesPanelRefresh(prev => prev + 1);
              console.log('📥 Node created via helper:', data.data.node.title);
              break;
              
            case 'NODE_UPDATED':
              const currentOpenTabs = openTabsRef.current;
              const updatedNodeId = Number(data.data.nodeId);
              console.log('🔍 NODE_UPDATED - nodeId:', updatedNodeId, 'openTabs:', currentOpenTabs);
              // Trigger FocusPanel refresh for open tabs  
              if (currentOpenTabs.includes(updatedNodeId)) {
                console.log('🔄 Triggering FocusPanel refresh for node:', updatedNodeId);
                setFocusPanelRefresh(prev => prev + 1);
              } else {
                console.log('⚠️ Node not in open tabs, skipping FocusPanel refresh');
              }
              // Also refresh NodesPanel in case title changed
              setNodesPanelRefresh(prev => prev + 1);
              console.log('✏️ Node updated via helper:', updatedNodeId);
              break;
              
            case 'NODE_DELETED':
              // Remove from tabs and selection if open
              handleNodeDeleted(data.data.nodeId);
              // Trigger NodesPanel refresh
              setNodesPanelRefresh(prev => prev + 1);
              console.log('🗑️ Node deleted via helper:', data.data.nodeId);
              break;
              
            case 'EDGE_CREATED':
            case 'EDGE_DELETED':
              // Trigger FocusPanel refresh for affected nodes
              const currentOpenTabsForEdge = openTabsRef.current;
              console.log('🔗 Edge changed - fromNodeId:', data.data.fromNodeId, 'toNodeId:', data.data.toNodeId, 'openTabs:', currentOpenTabsForEdge);
              if (currentOpenTabsForEdge.includes(data.data.fromNodeId) || currentOpenTabsForEdge.includes(data.data.toNodeId)) {
                console.log('🔄 Triggering FocusPanel refresh for edge change');
                setFocusPanelRefresh(prev => prev + 1);
              } else {
                console.log('⚠️ Neither edge node in open tabs, skipping FocusPanel refresh');
              }
              console.log('🔗 Edge changed via helper');
              break;
            case 'DIMENSION_UPDATED':
              console.log('📁 Dimension updated event received:', data.data?.dimension);
              setNodesPanelRefresh(prev => prev + 1);
              setFolderViewRefresh(prev => prev + 1);
              break;
            
            case 'HELPER_UPDATED':
            case 'AGENT_UPDATED':
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('agents:updated', { detail: data.data }));
              }
              break;
            case 'AGENT_DELEGATION_CREATED':
              console.log('[ThreePanelLayout] AGENT_DELEGATION_CREATED received:', data.data);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('delegations:created', { detail: data.data }));
                console.log('[ThreePanelLayout] Dispatched delegations:created event');
              }
              break;
          case 'AGENT_DELEGATION_UPDATED':
            console.log('[ThreePanelLayout] AGENT_DELEGATION_UPDATED received:', data.data);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('delegations:updated', { detail: data.data }));
              console.log('[ThreePanelLayout] Dispatched delegations:updated event');
            }
            break;

          case 'WORKFLOW_PROGRESS':
            console.log('[ThreePanelLayout] WORKFLOW_PROGRESS received:', data.data);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('workflow:progress', { detail: data.data }));
            }
            break;

          case 'CONNECTION_ESTABLISHED':
            console.log('✅ SSE connection established');
            break;
              
            default:
              console.log('📡 Unknown SSE event:', data.type);
          }
        } catch (error) {
          console.error('Failed to parse SSE event:', error);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
      };
    } catch (error) {
      console.error('Failed to establish SSE connection:', error);
    }
    
    // Cleanup on unmount
    return () => {
      if (eventSource) {
        eventSource.close();
        console.log('🔌 SSE connection closed');
      }
    };
  }, []); // Empty dependency array - connect once on mount

  // Handle panel resizing
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - containerRect.left) / containerRect.width) * 100;

    if (isDraggingLeft) {
      const newLeftWidth = Math.max(15, Math.min(35, mouseX));
      const diff = newLeftWidth - leftWidth;
      setLeftWidth(newLeftWidth);
      setMiddleWidth(prev => Math.max(20, prev - diff));
    } else if (isDraggingRight) {
      const rightEdge = leftWidth + middleWidth;
      const newMiddleWidth = Math.max(20, Math.min(65, mouseX - leftWidth));
      setMiddleWidth(newMiddleWidth);
    }
  }, [isDraggingLeft, isDraggingRight, leftWidth, middleWidth]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingLeft(false);
    setIsDraggingRight(false);
  }, []);

  useEffect(() => {
    if (isDraggingLeft || isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isDraggingLeft, isDraggingRight, handleMouseMove, handleMouseUp]);

  const handleToggleFolderView = (nextState?: boolean) => {
    setFolderViewOpen(prev => typeof nextState === 'boolean' ? nextState : !prev);
  };

  const handleFolderViewDataChanged = useCallback(() => {
    setFolderViewRefresh(prev => prev + 1);
    setNodesPanelRefresh(prev => prev + 1);
  }, []);

  const handleNodeOpenFromFolderView = (nodeId: number) => {
    handleNodeSelect(nodeId, false);
    setFolderViewOpen(false);
  };

  const handleReorderTabs = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setOpenTabs(prev => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length) {
        return prev;
      }
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  };

  // Handle node selection
  const handleNodeSelect = (nodeId: number, multiSelect: boolean) => {
    if (folderViewOpen) {
      setFolderViewOpen(false);
    }
    if (multiSelect) {
      const newSelection = new Set(selectedNodes);
      if (newSelection.has(nodeId)) {
        newSelection.delete(nodeId);
      } else {
        newSelection.add(nodeId);
      }
      setSelectedNodes(newSelection);

      const newTabs = Array.from(newSelection);
      setOpenTabs(newTabs);
      if (newTabs.length > 0 && !activeTab) {
        setActiveTab(newTabs[0]);
      }
    } else {
      setSelectedNodes(new Set<number>([nodeId]));

      if (!openTabs.includes(nodeId)) {
        setOpenTabs([...openTabs, nodeId]);
      }
      setActiveTab(nodeId);
    }
  };

  const handleTabSelect = (tabId: number) => {
    setSelectedNodes(new Set<number>([tabId]));
    setActiveTab(tabId);
  };

  // Handle tab close
  const handleCloseTab = (tabId: number) => {
    const newTabs = openTabs.filter(id => id !== tabId);
    setOpenTabs(newTabs);

    if (activeTab === tabId) {
      const currentIndex = openTabs.indexOf(tabId);
      if (newTabs.length > 0) {
        const newIndex = Math.min(currentIndex, newTabs.length - 1);
        setActiveTab(newTabs[newIndex]);
      } else {
        setActiveTab(null);
      }
    }

    const newSelection = new Set(selectedNodes);
    newSelection.delete(tabId);
    setSelectedNodes(newSelection);
  };

  // Handle node creation - auto-open the new node in Focus panel
  const handleNodeCreated = (newNode: Node) => {
    // Auto-select the new node
    setSelectedNodes(new Set<number>([newNode.id]));
    
    // Auto-open the new node as a tab
    if (!openTabs.includes(newNode.id)) {
      setOpenTabs([...openTabs, newNode.id]);
    }
    
    // Set as active tab
    setActiveTab(newNode.id);
  };

  // Handle node deletion - close tab and remove from selection
  const handleNodeDeleted = (nodeId: number) => {
    // Close tab if open
    handleCloseTab(nodeId);
  };

  // Calculate panel widths based on collapse states
  const baseRightWidth = nodesCollapsed ? (100 - middleWidth) : (100 - leftWidth - middleWidth);
  const effectiveLeftWidth = nodesCollapsed ? 0 : leftWidth;

  // When chat is collapsed, middle panel takes its space (but leave room for 64px rail)
  const effectiveRightWidth = chatCollapsed ? 0 : baseRightWidth;
  // Note: When chatCollapsed, we use calc() to leave room for the 64px collapsed rail
  const effectiveMiddleWidth = chatCollapsed
    ? (nodesCollapsed ? 100 : (middleWidth + baseRightWidth))
    : (nodesCollapsed ? (leftWidth + middleWidth) : middleWidth);

  const activeNodeId = activeTab;

  return (
    <div 
      ref={containerRef}
      style={{ 
        display: 'flex', 
        height: '100vh', 
        width: '100vw',
        background: '#0a0a0a',
        overflow: 'hidden'
      }}
    >
      {/* Left Panel - Nodes (collapsible) */}
      {nodesCollapsed ? (
        // Collapsed rail
        <div style={{
          width: '40px',
          flexShrink: 0,
          borderRight: '1px solid #2a2a2a',
          background: '#0a0a0a',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: '12px'
        }}>
          <button
            onClick={() => setNodesCollapsed(false)}
            style={{
              padding: '8px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '4px',
              color: '#888',
              cursor: 'pointer',
              fontSize: '12px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#2a2a2a';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.color = '#888';
            }}
            title="Expand Nodes (⌘1)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <div 
            style={{ 
              width: `${effectiveLeftWidth}%`,
              flexShrink: 0,
              borderRight: '1px solid #1a1a1a',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: '#0a0a0a',
              position: 'relative',
              padding: '4px'
            }}
          >
            <NodesPanel 
              selectedNodes={selectedNodes}
              onNodeSelect={handleNodeSelect}
              onNodeCreated={handleNodeCreated}
              onNodeDeleted={handleNodeDeleted}
              refreshTrigger={nodesPanelRefresh}
              onToggleFolderView={handleToggleFolderView}
              folderViewOpen={folderViewOpen}
            />
            <SettingsCog onClick={() => {
              setSettingsInitialTab(undefined);
              setShowSettings(true);
            }} />
          </div>

          {/* Left Resize Handle */}
          <div
            onMouseDown={() => setIsDraggingLeft(true)}
            style={{
              width: '3px',
              cursor: 'col-resize',
              background: isDraggingLeft ? '#353535' : 'transparent',
              transition: isDraggingLeft ? 'none' : 'background 0.2s'
            }}
            onMouseEnter={(e) => { if (!isDraggingLeft) e.currentTarget.style.background = '#1f1f1f'; }}
            onMouseLeave={(e) => { if (!isDraggingLeft) e.currentTarget.style.background = 'transparent'; }}
          />
        </>
      )}

      {/* Middle Panel - Focus */}
      <div
        style={{
          width: chatCollapsed
            ? (nodesCollapsed
                ? `calc(100% - 40px)`
                : `calc(100% - ${effectiveLeftWidth}% - 3px)`)
            : `${effectiveMiddleWidth}%`,
          flexShrink: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: '#0a0a0a',
          padding: '8px',
          paddingRight: chatCollapsed ? '8px' : '4px'
        }}
      >
        <div style={{
          flex: 1,
          background: '#141414',
          borderRadius: '8px',
          border: '1px solid #1f1f1f',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          padding: chatCollapsed ? '20px' : '0',
          position: 'relative'
        }}>
        {/* Expand chat button - shown when collapsed */}
        {chatCollapsed && (
          <button
            onClick={() => setChatCollapsed(false)}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
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
              transition: 'all 0.15s ease',
              zIndex: 10
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.color = '#999';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#666';
            }}
            title="Expand Chat (⌘\)"
          >
            <Maximize2 size={14} />
          </button>
        )}
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <div style={{
            height: '100%',
            visibility: folderViewOpen ? 'hidden' : 'visible',
            pointerEvents: folderViewOpen ? 'none' : 'auto'
          }}>
            <FocusPanel
              openTabs={openTabs}
              activeTab={activeTab}
              onTabSelect={handleTabSelect}
              onNodeClick={(nodeId) => handleNodeSelect(nodeId, false)}
              onTabClose={handleCloseTab}
              refreshTrigger={focusPanelRefresh}
              onReorderTabs={handleReorderTabs}
            />
          </div>
          {folderViewOpen && (
            <FolderViewOverlay
              onClose={() => handleToggleFolderView(false)}
              onNodeOpen={handleNodeOpenFromFolderView}
              refreshToken={folderViewRefresh}
              onDataChanged={handleFolderViewDataChanged}
            />
          )}
        </div>
        </div>
      </div>

      {/* Right Resize Handle */}
      {!nodesCollapsed && !chatCollapsed && (
        <div
          onMouseDown={() => setIsDraggingRight(true)}
          style={{
            width: '3px',
            cursor: 'col-resize',
            background: isDraggingRight ? '#353535' : 'transparent',
            transition: isDraggingRight ? 'none' : 'background 0.2s'
          }}
          onMouseEnter={(e) => { if (!isDraggingRight) e.currentTarget.style.background = '#1f1f1f'; }}
          onMouseLeave={(e) => { if (!isDraggingRight) e.currentTarget.style.background = 'transparent'; }}
        />
      )}

      {/* Right Panel - Agents (collapsible) */}
      {!chatCollapsed && (
        <div
          style={{
            width: `${effectiveRightWidth}%`,
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: '#0a0a0a',
            position: 'relative',
            padding: '8px',
            paddingLeft: '4px'
          }}
        >
          <div style={{
            flex: 1,
            background: '#141414',
            borderRadius: '8px',
            border: '1px solid #1f1f1f',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <AgentsPanel
              openTabsData={openTabsData}
              activeTabId={activeNodeId}
              onNodeClick={(nodeId) => handleNodeSelect(nodeId, false)}
              onCollapse={() => setChatCollapsed(true)}
            />
          </div>
        </div>
      )}
      
      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={handleCloseSettings}
        initialTab={settingsInitialTab}
      />
    </div>
  );
}
