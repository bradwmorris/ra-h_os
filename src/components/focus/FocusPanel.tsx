"use client";

import { useState, useEffect, useRef } from 'react';
import { Eye, Trash2, Link, Loader, Database, Check } from 'lucide-react';
import { parseAndRenderContent } from '@/components/helpers/NodeLabelRenderer';
import { parseNodeMarkers } from '@/tools/infrastructure/nodeFormatter';
import { Node, NodeConnection } from '@/types/database';
import DimensionTags from './dimensions/DimensionTags';
import { getNodeIcon } from '@/utils/nodeIcons';
import ConfirmDialog from '../common/ConfirmDialog';

interface PopularDimension {
  dimension: string;
  count: number;
  isPriority: boolean;
}

interface DimensionsResponse {
  success: boolean;
  data: PopularDimension[];
}

interface NodeSearchResult {
  id: number;
  title: string;
  dimensions?: string[];
}

interface FocusPanelProps {
  openTabs: number[];
  activeTab: number | null;
  onTabSelect: (nodeId: number) => void;
  onNodeClick?: (nodeId: number) => void;
  onTabClose: (nodeId: number) => void;
  refreshTrigger?: number;
  onReorderTabs?: (fromIndex: number, toIndex: number) => void;
}

export default function FocusPanel({ openTabs, activeTab, onTabSelect, onNodeClick, onTabClose, refreshTrigger }: FocusPanelProps) {
  const [nodesData, setNodesData] = useState<Record<number, Node>>({}); 
  const [loadingNodes, setLoadingNodes] = useState<Set<number>>(new Set());
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [editingNodeId, setEditingNodeId] = useState<number | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [embeddingNode, setEmbeddingNode] = useState<number | null>(null);
  const [showReembedPrompt, setShowReembedPrompt] = useState<number | null>(null);
  const [priorityDimensions, setPriorityDimensions] = useState<string[]>([]);
  
  const activeNodeId = activeTab;
  const currentNode = activeNodeId !== null ? nodesData[activeNodeId] : undefined;

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  // Auto-hide re-embed prompt after a few seconds
  useEffect(() => {
    if (showReembedPrompt !== null) {
      const timeout = setTimeout(() => setShowReembedPrompt(null), 4000);
      return () => clearTimeout(timeout);
    }
  }, [showReembedPrompt]);

  // Edges state management (following same patterns as nodes)
  const [edgesData, setEdgesData] = useState<{ [key: number]: NodeConnection[] }>({});
  const [loadingEdges, setLoadingEdges] = useState<Set<number>>(new Set());
  const [addingEdge, setAddingEdge] = useState<number | null>(null);
  const [nodeSearchQuery, setNodeSearchQuery] = useState('');
  const [nodeSearchSuggestions, setNodeSearchSuggestions] = useState<NodeSearchResult[]>([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [edgeExplanation, setEdgeExplanation] = useState('');
  const [deletingEdge, setDeletingEdge] = useState<number | null>(null);
  const [edgeEditingId, setEdgeEditingId] = useState<number | null>(null);
  const [edgeEditingValue, setEdgeEditingValue] = useState<string>('');
  const [edgeSavingId, setEdgeSavingId] = useState<number | null>(null);
  const [deletingNode, setDeletingNode] = useState<number | null>(null);
  const [pendingDeleteNodeId, setPendingDeleteNodeId] = useState<number | null>(null);
  
  // Chunk content toggle state - default to expanded (true)
  const [chunkExpanded, setChunkExpanded] = useState<{ [key: number]: boolean }>({});
  
  // Edges expand/collapse state
  const [edgesExpanded, setEdgesExpanded] = useState<{ [key: number]: boolean }>({});
  
  // Connections section collapsed state (default closed)
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  
  // Title expanded state for click-to-expand full title
  const [titleExpanded, setTitleExpanded] = useState<{ [key: number]: boolean }>({});

  // Fetch priority dimensions on mount
  useEffect(() => {
    fetchPriorityDimensions();
  }, []);

  // Generate node search suggestions
  useEffect(() => {
    if (!nodeSearchQuery.trim() || !activeTab) {
      setNodeSearchSuggestions([]);
      return;
    }

    const fetchNodeSearchSuggestions = async () => {
      try {
        const response = await fetch(`/api/nodes/search?q=${encodeURIComponent(nodeSearchQuery)}&limit=10`);
        const result = await response.json();
        
        if (result.success) {
          const nodeSuggestions: NodeSearchResult[] = result.data
            .filter((node: any) => node.id !== activeTab) // Exclude current node
            .map((node: any) => ({
              id: node.id,
              title: node.title,
              dimensions: node.dimensions || []
            }));
          
          setNodeSearchSuggestions(nodeSuggestions);
          setSelectedSearchIndex(0);
        }
      } catch (error) {
        console.error('Error fetching node search suggestions:', error);
        setNodeSearchSuggestions([]);
      }
    };

    const timeoutId = setTimeout(fetchNodeSearchSuggestions, 200);
    return () => clearTimeout(timeoutId);
  }, [nodeSearchQuery, activeTab]);

  // Fetch node data when new tabs are opened
  useEffect(() => {
    openTabs.forEach((tabId) => {
      if (!nodesData[tabId] && !loadingNodes.has(tabId)) {
        fetchNodeData(tabId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTabs]);

  useEffect(() => {
    openTabs.forEach((tabId) => {
      if (nodesData[tabId] && !edgesData[tabId] && !loadingEdges.has(tabId)) {
        fetchEdgesData(tabId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTabs, nodesData, edgesData]);


  // Refresh data when SSE events trigger updates
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0 && activeTab) {
      fetchNodeData(activeTab);
      fetchEdgesData(activeTab);
    }
  }, [refreshTrigger, activeTab]);


  const fetchPriorityDimensions = async () => {
    try {
      const response = await fetch('/api/dimensions/popular');
      const payload = (await response.json()) as DimensionsResponse;
      if (payload?.success && Array.isArray(payload.data)) {
        const priority = payload.data.filter((d) => d.isPriority).map((d) => d.dimension);
        setPriorityDimensions(priority);
      }
    } catch (error) {
      console.error('Error fetching priority dimensions:', error);
    }
  };

  const fetchNodeData = async (id: number) => {
    setLoadingNodes(prev => new Set(prev).add(id));
    // First try to fetch as a node
    try {
      const nodeResponse = await fetch(`/api/nodes/${id}`);
      if (nodeResponse.ok) {
        const data = await nodeResponse.json();
        if (data.node) {
          setNodesData(prev => ({ ...prev, [id]: data.node }));
          setLoadingNodes(prev => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
          });
          return;
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch node ${id}:`, error);
    }
    setLoadingNodes(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };


  const fetchEdgesData = async (nodeId: number) => {
    setLoadingEdges(prev => new Set(prev).add(nodeId));
    try {
      const response = await fetch(`/api/nodes/${nodeId}/edges`);
      const data = await response.json();
      if (data.success && data.data) {
        setEdgesData(prev => ({ ...prev, [nodeId]: data.data }));
      }
    } catch (error) {
      console.error(`Error fetching edges for node ${nodeId}:`, error);
    } finally {
      setLoadingEdges(prev => {
        const newSet = new Set(prev);
        newSet.delete(nodeId);
        return newSet;
      });
    }
  };


  const truncateTitle = (title: string, maxLength: number = 20) => {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength) + '...';
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.select();
      }
    }
  }, [editingField]);

  const startEdit = (field: string, currentValue: string) => {
    if (savingField) return; // Don't start edit if currently saving
    setEditingField(field);
    setEditingValue(currentValue || '');
    if (activeNodeId !== null) setEditingNodeId(activeNodeId);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditingValue('');
    setEditingNodeId(null);
  };

  const saveField = async () => {
    const nodeId = editingNodeId ?? activeNodeId;
    if (!nodeId || !editingField) return;
    // Validate required fields
    if (editingField === 'title' && !editingValue.trim()) {
      alert('Title cannot be empty');
      return;
    }

    setSavingField(editingField);
    try {
      const updateData: Record<string, string> = {};

      if (editingField === 'content') {
        updateData.content = editingValue;
      } else {
        updateData[editingField] = editingValue;
      }

      const response = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error('Failed to save');
      }

      const result = await response.json();
      if (result.node) {
        setNodesData(prev => ({ ...prev, [nodeId]: result.node }));
      }

      // Safety net: ensure edges exist for any tokens present in saved content
      if (editingField === 'content' && typeof editingValue === 'string') {
        try {
          const tokens = parseNodeMarkers(editingValue);
          const uniqueTargets = Array.from(new Set(tokens.map(t => t.id))).filter(id => id !== nodeId);
          await Promise.allSettled(uniqueTargets.map(async (toId) => {
            await fetch('/api/edges', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from_node_id: nodeId,
                to_node_id: toId,
                source: 'user',
                context: { explanation: 'Referenced via @ mention', created_via: 'at_mention' }
              })
            });
          }));
          // Refresh edges after ensuring
          await fetchEdgesData(nodeId);
        } catch (e) {
          console.warn('Failed to ensure edges from tokens:', e);
        }
      }
      
      setEditingField(null);
      setEditingValue('');
      setEditingNodeId(null);
    } catch (error) {
      console.error('Error saving field:', error);
      alert('Failed to save changes. Please try again.');
    } finally {
      setSavingField(null);
    }
  };

  // Explicit content saver to avoid stale state reads (used after @mention insert)
  const saveContentExplicit = async (contentValue: string, nodeId: number) => {
    if (!nodeId) return;
    setSavingField('content');
    try {
      const response = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentValue }),
      });
      if (!response.ok) throw new Error('Failed to save');
      const result = await response.json();
      if (result.node) {
        setNodesData(prev => ({ ...prev, [nodeId]: result.node }));
      }
      // Safety net: ensure edges for tokens in this specific content
      try {
        const tokens = parseNodeMarkers(contentValue);
        const uniqueTargets = Array.from(new Set(tokens.map(t => t.id))).filter(id => id !== nodeId);
        await Promise.allSettled(uniqueTargets.map(async (toId) => {
          await fetch('/api/edges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from_node_id: nodeId,
              to_node_id: toId,
              source: 'user',
              context: { explanation: 'Referenced via @ mention', created_via: 'at_mention' }
            })
          });
        }));
        await fetchEdgesData(nodeId);
      } catch (e) {
        console.warn('Failed to ensure edges from tokens (explicit save):', e);
      }
      // Exit edit mode
      setEditingField(null);
      setEditingValue('');
    } catch (e) {
      console.error('Error saving content (explicit):', e);
      alert('Failed to save changes. Please try again.');
    } finally {
      setSavingField(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveField();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const handleBlur = () => {
    // If mention is active, defer saving slightly to avoid race with selection
    const attemptSave = () => {
      if (editingField) {
        saveField();
      }
    };
    if (mentionActive) {
      setTimeout(() => {
        if (!mentionActive) attemptSave();
      }, 220);
      return;
    }
    // Small delay to allow for clicking inline buttons
    setTimeout(attemptSave, 150);
  };

  // --- @mention state ---
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionResults, setMentionResults] = useState<NodeSearchResult[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetMention = () => {
    setMentionActive(false);
    setMentionQuery('');
    setMentionResults([]);
    setMentionIndex(0);
  };

  const findAtTrigger = (text: string, caret: number): { atIndex: number; query: string } | null => {
    // Find last '@' before caret that is at start or preceded by whitespace
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === '@') {
        const prev = i === 0 ? ' ' : text[i - 1];
        if (/\s/.test(prev)) {
          const span = text.slice(i + 1, caret);
          // Stop if span contains disallowed characters (newline or punctuation other than - _ .)
          if (/[^A-Za-z0-9 _\-.]/.test(span)) return null;
          return { atIndex: i, query: span };
        }
        // If '@' is not preceded by whitespace, keep scanning left
      }
      // Stop scanning back on whitespace/newline to avoid spanning words
      if (ch === '\n') break;
    }
    return null;
  };

  const runMentionSearch = async (query: string) => {
    if (!activeTab) return;
    if (query.trim().length < 2) {
      setMentionResults([]);
      return;
    }
    try {
      const resp = await fetch(`/api/nodes/search?q=${encodeURIComponent(query)}&limit=10`);
      const payload = (await resp.json()) as { success: boolean; data: NodeSearchResult[] };
      if (payload?.success && Array.isArray(payload.data)) {
        const filtered = payload.data
          .filter((n) => n.id !== activeTab)
          .map((n) => ({ ...n, dimensions: n.dimensions ?? [] }));
        setMentionResults(filtered);
        setMentionIndex(0);
      }
    } catch (error) {
      console.warn('mention search failed:', error);
      setMentionResults([]);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setEditingValue(val);

    // Detect @mention
    const caret = e.target.selectionStart || val.length;
    const trig = findAtTrigger(val, caret);
    if (trig) {
      setMentionActive(true);
      setMentionQuery(trig.query);
      if (mentionTimeout.current) clearTimeout(mentionTimeout.current);
      mentionTimeout.current = setTimeout(() => runMentionSearch(trig.query), 280);
    } else if (mentionActive) {
      // Exit mention mode if trigger no longer valid
      resetMention();
    }
  };

  const replaceMentionWithToken = async (nodeId: number, title: string) => {
    if (!inputRef.current || !(inputRef.current instanceof HTMLTextAreaElement)) return;
    if (activeNodeId === null) return;
    const ta = inputRef.current as HTMLTextAreaElement;
    const sourceNodeId = activeNodeId!;
    const text = editingValue;
    const caret = ta.selectionStart || text.length;
    let trig = findAtTrigger(text, caret);
    if (!trig) {
      // Fallback: try to locate the last occurrence of the current mention token
      if (mentionQuery && mentionQuery.length > 0) {
        const needle = '@' + mentionQuery;
        const idx = text.lastIndexOf(needle);
        if (idx !== -1) {
          trig = { atIndex: idx, query: mentionQuery };
        }
      }
      if (!trig) return;
    }
    // Build quote-safe token
    const quoteTitleForToken = (t: string): string => {
      if (t.includes('"')) {
        // Wrap with single quotes; normalize inner straight single quotes
        const norm = t.replace(/'/g, '’');
        return `'${norm}'`;
      }
      // Wrap with double quotes; keep title as-is (no straight doubles inside)
      return `"${t}"`;
    };
    const token = `[NODE:${nodeId}:${quoteTitleForToken(title)}]`;
    const before = text.slice(0, trig.atIndex);
    const after = text.slice(trig.atIndex + 1 + trig.query.length); // skip '@' and query
    const newVal = before + token + after;
    setEditingValue(newVal);
    // Restore caret after token
    const newCaret = (before + token).length;
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = newCaret;
      ta.focus();
    });

    // Create edge (idempotent server-side)
    if (sourceNodeId) {
      try {
        await fetch('/api/edges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from_node_id: sourceNodeId,
            to_node_id: nodeId,
            source: 'user',
            context: { explanation: 'Referenced via @ mention', created_via: 'at_mention' }
          })
        });
      } catch (e) {
        console.warn('edge create failed for mention:', e);
      }
    }

    resetMention();

    // Persist content immediately to avoid losing the token on refresh/navigation
    try {
      await saveContentExplicit(newVal, sourceNodeId);
    } catch (e) {
      console.warn('auto-save after mention failed:', e);
    }
  };

  const embedContent = async (nodeId: number) => {
    const node = nodesData[nodeId];
    const hasContent = node?.content?.trim();
    const hasChunk = node?.chunk?.trim();
    // If chunk is empty but content exists, auto-populate chunk from content
    if (!hasChunk && hasContent) {
      try {
        const response = await fetch(`/api/nodes/${nodeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chunk: hasContent })
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.node) {
            setNodesData(prev => ({ ...prev, [nodeId]: result.node }));
          }
        }
      } catch (error) {
        console.error('Failed to auto-populate chunk for embedding:', error);
        return;
      }
    }
    // If neither content nor chunk exist, require content
    if (!hasContent && !hasChunk) {
      startEdit('content', '');
      return;
    }
    setEmbeddingNode(nodeId);
    try {
      const response = await fetch('/api/ingestion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nodeId }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to embed content');
      }

      // Show result details
      const nodeStatus = result.node_embedding?.status;
      const chunkStatus = result.chunk_embeddings?.status;
      const chunksCreated = result.chunk_embeddings?.chunks_created || 0;
      
      let message = 'Embedding complete:\n';
      if (nodeStatus === 'completed') message += '✓ Node metadata embedded\n';
      if (chunkStatus === 'completed') message += `✓ ${chunksCreated} chunks embedded\n`;
      if (chunkStatus === 'skipped') message += '• No chunk content to embed\n';
      
      console.log(message.trim());

      // Refresh node data to get updated status
      await fetchNodeData(nodeId);
      
    } catch (error) {
      console.error('Error embedding content:', error);
      alert(`Failed to embed content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setEmbeddingNode(null);
    }
  };


  // Edge management functions (following same patterns as node functions)

  const handleEdgeNodeSelect = (targetNodeId: number, _targetNodeTitle?: string) => {
    createEdgeWithExplanation(targetNodeId, '');
  };

  // Handle node search keyboard navigation
  const handleNodeSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSearchIndex(prev => Math.min(prev + 1, nodeSearchSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSearchIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && nodeSearchSuggestions[selectedSearchIndex]) {
      e.preventDefault();
      handleSelectNodeSuggestion(nodeSearchSuggestions[selectedSearchIndex]);
    }
  };

  const handleSelectNodeSuggestion = (suggestion: NodeSearchResult) => {
    createEdgeWithExplanation(suggestion.id, '');
    setNodeSearchQuery('');
    setNodeSearchSuggestions([]);
  };

  const createEdgeWithExplanation = async (targetNodeId: number, explanation: string) => {
    if (activeNodeId === null) return;
    try {
      const response = await fetch('/api/edges', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from_node_id: activeNodeId,
          to_node_id: targetNodeId,
          source: 'user',
          context: {
            explanation: explanation,
            created_via: 'focus_panel'
          }
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create edge');
      }

      // Refresh edges data
      await fetchEdgesData(activeNodeId);
      
      // Reset state
      setAddingEdge(null);
      setEdgeExplanation('');
      
    } catch (error) {
      console.error('Error creating edge:', error);
      alert('Failed to create edge. Please try again.');
    }
  };

  const startEditEdgeExplanation = (edgeId: number, currentExplanation: string | undefined) => {
    if (edgeSavingId) return;
    setEdgeEditingId(edgeId);
    setEdgeEditingValue(currentExplanation || '');
  };

  const cancelEditEdgeExplanation = () => {
    setEdgeEditingId(null);
    setEdgeEditingValue('');
  };

  const saveEdgeExplanation = async (
    edgeId: number,
    currentContext: Record<string, unknown> | null | undefined
  ) => {
    if (activeNodeId === null) return;
    setEdgeSavingId(edgeId);
    try {
      const newContext: Record<string, unknown> = {
        ...(currentContext ?? {}),
        explanation: edgeEditingValue
      };
      const response = await fetch(`/api/edges/${edgeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: newContext })
      });
      if (!response.ok) throw new Error('Failed to update edge');
      await fetchEdgesData(activeNodeId);
      setEdgeEditingId(null);
      setEdgeEditingValue('');
    } catch (e) {
      console.error('Failed updating edge explanation:', e);
      alert('Failed to update edge explanation');
    } finally {
      setEdgeSavingId(null);
    }
  };

  const deleteEdge = async (edgeId: number) => {
    if (activeNodeId === null) return;
    setDeletingEdge(edgeId);
    try {
      const response = await fetch(`/api/edges/${edgeId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete edge');
      }

      await fetchEdgesData(activeNodeId);
      
    } catch (error) {
      console.error('Error deleting edge:', error);
      alert('Failed to delete edge. Please try again.');
    } finally {
      setDeletingEdge(null);
    }
  };

  const renderConnectionsBody = () => {
    if (!activeTab) {
      return <div style={{ color: '#777', fontSize: '12px' }}>Open a node to manage connections.</div>;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Search Section */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            background: '#141414',
            padding: '16px 20px',
            borderRadius: '12px',
            border: '1px solid #262626',
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.02)'
          }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="#525252" style={{ flexShrink: 0 }}>
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              value={nodeSearchQuery}
              onChange={(e) => setNodeSearchQuery(e.target.value)}
              onKeyDown={handleNodeSearchKeyDown}
              placeholder="Connect to node..."
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#fafafa',
                fontSize: '16px',
                fontFamily: 'inherit',
                fontWeight: 400
              }}
            />
          </div>
          
          {/* Search Suggestions */}
          {nodeSearchSuggestions.length > 0 && (
            <div style={{
              marginTop: '8px',
              background: '#141414',
              border: '1px solid #262626',
              borderRadius: '12px',
              maxHeight: '240px',
              overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.02)'
            }}>
              {nodeSearchSuggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id}
                  onClick={() => handleSelectNodeSuggestion(suggestion)}
                  style={{
                    padding: '14px 16px',
                    cursor: 'pointer',
                    borderBottom: index < nodeSearchSuggestions.length - 1 ? '1px solid #1f1f1f' : 'none',
                    background: index === selectedSearchIndex ? '#1a1a1a' : 'transparent',
                    transition: 'background 100ms ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => {
                    if (index !== selectedSearchIndex) {
                      e.currentTarget.style.background = '#1a1a1a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (index !== selectedSearchIndex) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: '#0a0a0a',
                    background: '#22c55e',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    minWidth: '28px',
                    textAlign: 'center',
                    flexShrink: 0,
                    fontFamily: "'SF Mono', 'Fira Code', monospace"
                  }}>
                    #{suggestion.id}
                  </span>
                  <span style={{
                    fontSize: '15px',
                    color: '#e5e5e5',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1
                  }}>
                    {suggestion.title}
                  </span>
                  {index === selectedSearchIndex && (
                    <span style={{ color: '#525252', fontSize: '13px' }}>↵</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Existing Connections */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: '12px', color: '#737373', marginBottom: '12px', letterSpacing: '0.02em' }}>
            Existing Connections
          </div>
          {loadingEdges.has(activeTab) ? (
            <div style={{ color: '#777', fontSize: '12px', fontStyle: 'italic' }}>Loading connections…</div>
          ) : (() => {
            const list = edgesData[activeTab] || [];
            if (list.length === 0) {
              return <div style={{ color: '#777', fontSize: '12px', fontStyle: 'italic' }}>No connections yet. Search above to add one.</div>;
            }
            const visible = edgesExpanded[activeTab] ? list : list.slice(0, 5);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {visible.map((connection) => (
                  <div key={connection.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          display: 'inline-block',
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#000',
                          background: '#22c55e',
                          padding: '2px 6px',
                          borderRadius: '6px',
                          minWidth: '20px',
                          textAlign: 'center',
                          letterSpacing: '0.05em'
                        }}>
                          {connection.connected_node.id}
                        </span>
                        <span style={{ color: '#f8fafc', fontSize: '14px', fontWeight: 500 }}>{connection.connected_node.title}</span>
                      </div>
                      {edgeEditingId === connection.edge.id ? (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input
                            value={edgeEditingValue}
                            onChange={(e) => setEdgeEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                saveEdgeExplanation(connection.edge.id, connection.edge.context);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEditEdgeExplanation();
                              }
                            }}
                            style={{
                              flex: 1,
                              fontSize: '11px',
                              color: '#ddd',
                              background: 'transparent',
                              border: '1px solid #1a1a1a',
                              borderRadius: '0',
                              padding: '4px',
                              outline: 'none',
                              fontFamily: 'inherit'
                            }}
                            placeholder="Add explanation…"
                            autoFocus
                          />
                          <button
                            onClick={() => saveEdgeExplanation(connection.edge.id, connection.edge.context)}
                            disabled={edgeSavingId === connection.edge.id}
                            style={{
                              fontSize: '10px',
                              color: edgeSavingId === connection.edge.id ? '#555' : '#999',
                              background: 'transparent',
                              border: '1px solid #222',
                              borderRadius: '2px',
                              padding: '3px 6px',
                              cursor: edgeSavingId === connection.edge.id ? 'not-allowed' : 'pointer'
                            }}
                          >
                            {edgeSavingId === connection.edge.id ? 'saving…' : 'save'}
                          </button>
                          <button
                            onClick={cancelEditEdgeExplanation}
                            disabled={edgeSavingId === connection.edge.id}
                            style={{
                              fontSize: '10px',
                              color: '#666',
                              background: 'transparent',
                              border: 'none',
                              padding: '3px 4px',
                              cursor: 'pointer'
                            }}
                          >
                            cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {connection.edge.context?.explanation ? (
                            <span style={{ color: '#94a3b8', fontSize: '12px' }}>— {connection.edge.context.explanation}</span>
                          ) : (
                            <span style={{ color: '#64748b', fontSize: '12px', fontStyle: 'italic' }}>No explanation</span>
                          )}
                          <button
                            onClick={() => startEditEdgeExplanation(connection.edge.id, connection.edge.context?.explanation)}
                            style={{
                              fontSize: '11px',
                              color: '#94a3b8',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              textDecoration: 'underline'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#cbd5f5'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
                          >
                            edit
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteEdge(connection.edge.id)}
                      disabled={deletingEdge === connection.edge.id}
                      style={{
                        color: deletingEdge === connection.edge.id ? '#64748b' : '#94a3b8',
                        fontSize: '14px',
                        background: 'transparent',
                        border: 'none',
                        cursor: deletingEdge === connection.edge.id ? 'not-allowed' : 'pointer',
                        padding: '2px 4px',
                        transition: 'color 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (deletingEdge !== connection.edge.id) {
                          e.currentTarget.style.color = '#dc2626';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (deletingEdge !== connection.edge.id) {
                          e.currentTarget.style.color = '#94a3b8';
                        }
                      }}
                    >
                      {deletingEdge === connection.edge.id ? '...' : '×'}
                    </button>
                  </div>
                ))}
                {list.length > 5 && (
                  <div style={{ marginTop: '6px' }}>
                    <button
                      onClick={() => setEdgesExpanded(prev => ({ ...prev, [activeTab]: !prev[activeTab] }))}
                      style={{
                        fontSize: '9px',
                        color: '#666',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'color 0.2s'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#999'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                    >
                      {edgesExpanded[activeTab] ? 'show less' : `show ${list.length - 5} more`}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  const handleConfirmNodeDelete = () => {
    if (pendingDeleteNodeId === null) return;
    executeDeleteNode(pendingDeleteNodeId);
    setPendingDeleteNodeId(null);
  };

  const handleCancelNodeDelete = () => {
    setPendingDeleteNodeId(null);
  };

  const executeDeleteNode = async (nodeId: number) => {
    setDeletingNode(nodeId);
    try {
      const response = await fetch(`/api/nodes/${nodeId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete node');
      }

      onTabClose(nodeId);
      setNodesData(prev => {
        const newData = { ...prev };
        delete newData[nodeId];
        return newData;
      });
      
    } catch (error) {
      console.error('Error deleting node:', error);
      alert('Failed to delete node. Please try again.');
    } finally {
      setDeletingNode(null);
    }
  };

  const confirmDeleteNode = (nodeId: number) => {
    setPendingDeleteNodeId(nodeId);
  };

  return (
    <>
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
      {/* Tab Bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #1a1a1a',
        background: '#0f0f0f',
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden'
      }}>
        {openTabs.length === 0 ? (
          <div style={{
            padding: '10px 16px',
            fontSize: '12px',
            color: '#666'
          }}>
            No tabs open
          </div>
        ) : (
          openTabs.map((tabId) => {
            const node = nodesData[tabId];
            const isActive = activeTab === tabId;
            const label = node ? truncateTitle(node.title || 'Untitled') : 'Loading...';

            return (
              <div
                key={tabId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderRight: '1px solid #1a1a1a',
                  background: isActive ? '#121212' : '#0f0f0f',
                  borderBottom: isActive ? '2px solid #666' : 'none',
                  paddingBottom: isActive ? '0' : '2px',
                  minWidth: '120px',
                  maxWidth: '200px'
                }}
              >
                <button
                  onClick={() => onTabSelect(tabId)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontFamily: 'inherit',
                    color: isActive ? '#fff' : '#999',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {label}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tabId);
                  }}
                  style={{
                    padding: '4px 8px',
                    fontSize: '14px',
                    color: '#666',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'color 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Content Area */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto',
        padding: '20px',
        position: 'relative'
      }}>
        {!activeTab ? (
          <div style={{
            color: '#666',
            fontSize: '13px',
            textAlign: 'center',
            marginTop: '40px'
          }}>
            Select a node from the left panel to view details
          </div>
        ) : loadingNodes.has(activeTab) ? (
          <div style={{
            color: '#666',
            fontSize: '13px'
          }}>
            Loading...
          </div>
        ) : !currentNode ? (
          <div style={{ color: '#666', fontSize: '13px' }}>Node not found.</div>
        ) : nodesData[activeTab] ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Header with status, link, and delete */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px',
              flexWrap: 'nowrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                {(() => {
                  const node = nodesData[activeTab];
                  const chunkStatus = node?.chunk_status ?? null;
                  const hasChunk = Boolean(node?.chunk && node.chunk.trim().length > 0);

                  const StatusBadge = ({ color, label }: { color: string; label: string }) => (
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      color: '#cbd5f5'
                    }}>
                      <span style={{ color }}>{'●'}</span>
                      {label}
                    </span>
                  );

                  if (embeddingNode === activeTab || chunkStatus === 'chunking') {
                    return (
                      <button
                        disabled
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'default',
                          padding: '4px'
                        }}
                        title="Embedding in progress..."
                      >
                        <div style={{ color: '#facc15' }}>
                          <Loader size={16} className="animate-spin" />
                        </div>
                      </button>
                    );
                  }

                  if (chunkStatus === 'chunked') {
                    if (showReembedPrompt === activeTab) {
                      return (
                        <>
                          <StatusBadge color="#10b981" label="Embedded" />
                          <button
                            onClick={() => {
                              embedContent(activeTab);
                              setShowReembedPrompt(null);
                            }}
                            style={{
                              padding: '3px 8px',
                              fontSize: '10px',
                              color: '#10b981',
                              border: '1px solid #0f4c3a',
                              background: 'transparent',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontFamily: 'inherit'
                            }}
                          >
                            Re-embed?
                          </button>
                        </>
                      );
                    }

                    return (
                      <button
                        onClick={() => setShowReembedPrompt(activeTab)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px'
                        }}
                        title="Embedded - click to re-embed"
                      >
                        <Database size={16} style={{ color: '#22c55e' }} />
                      </button>
                    );
                  }

                  if (chunkStatus === 'error') {
                    return (
                      <button
                        onClick={() => embedContent(activeTab)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px'
                        }}
                        title="Embedding failed - click to retry"
                      >
                        <Database size={16} style={{ color: '#ef4444' }} />
                      </button>
                    );
                  }

                  if (hasChunk) {
                    return (
                      <button
                        onClick={() => embedContent(activeTab)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px'
                        }}
                        title="Ready to embed - click to embed now"
                      >
                        <Database size={16} style={{ color: '#f97316' }} />
                      </button>
                    );
                  }

                  return (
                    <button
                      onClick={() => embedContent(activeTab)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                      title="Add content to embed"
                    >
                      <Database size={16} style={{ color: '#64748b' }} />
                    </button>
                  );
                })()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {editingField === 'link' ? (
                  <input
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    type="url"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                    disabled={savingField === 'link'}
                    style={{
                      color: '#3b82f6',
                      fontSize: '11px',
                      background: 'transparent',
                      border: '1px solid #1a1a1a',
                      borderRadius: '6px',
                      padding: '4px 6px',
                      fontFamily: 'inherit',
                      width: '100%',
                      outline: 'none'
                    }}
                    placeholder="Enter URL..."
                  />
                ) : nodesData[activeTab].link ? (
                  <a 
                    href={nodesData[activeTab].link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        startEdit('link', nodesData[activeTab].link || '');
                      }
                    }}
                    style={{
                      color: '#3b82f6',
                      fontSize: '11px',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'block'
                    }}
                    title={`${nodesData[activeTab].link} (Cmd+Click to edit)`}
                  >
                    {nodesData[activeTab].link}
                  </a>
                ) : (
                  <span 
                    onClick={() => startEdit('link', '')}
                    style={{
                      color: '#555',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontStyle: 'italic'
                    }}
                  >
                    Click to add URL
                  </span>
                )}
              </div>

              {/* Connections Button - Green CTA */}
              <button
                onClick={() => setShowConnectionsModal(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: '#22c55e',
                  background: 'transparent',
                  border: '1px solid #166534',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  transition: 'all 0.2s',
                  flexShrink: 0
                }}
                onMouseEnter={(e) => { 
                  e.currentTarget.style.background = '#0f2417'; 
                  e.currentTarget.style.borderColor = '#22c55e';
                }}
                onMouseLeave={(e) => { 
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = '#166534'; 
                }}
              >
                <Link size={14} />
                {activeTab && edgesData[activeTab] && edgesData[activeTab].length > 0 && (
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: '#22c55e',
                    background: '#0f2417',
                    border: '1px solid #166534',
                    borderRadius: '8px',
                    padding: '1px 5px',
                    minWidth: '16px',
                    textAlign: 'center'
                  }}>
                    {edgesData[activeTab].length}
                  </span>
                )}
              </button>

              {/* Delete Button */}
              <button
                onClick={() => confirmDeleteNode(activeTab)}
                disabled={deletingNode === activeTab}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px',
                  color: deletingNode === activeTab ? '#994444' : '#525252',
                  background: 'transparent',
                  border: '1px solid #262626',
                  borderRadius: '6px',
                  cursor: deletingNode === activeTab ? 'wait' : 'pointer',
                  transition: 'all 0.2s',
                  flexShrink: 0
                }}
                onMouseEnter={(e) => {
                  if (deletingNode !== activeTab) {
                    e.currentTarget.style.color = '#dc2626';
                    e.currentTarget.style.borderColor = '#dc2626';
                    e.currentTarget.style.background = 'rgba(220, 38, 38, 0.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (deletingNode !== activeTab) {
                    e.currentTarget.style.color = '#525252';
                    e.currentTarget.style.borderColor = '#262626';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
                title="Delete node"
              >
                {deletingNode === activeTab ? '...' : <Trash2 size={14} />}
              </button>
            </div>

            {/* Title Row with ID and Trash */}
            <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Node ID */}
              <span style={{
                display: 'inline-block',
                background: '#22c55e',
                color: '#0a0a0a',
                fontSize: '10px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                flexShrink: 0
              }}>
                #{activeTab}
              </span>

              {editingField === 'title' ? (
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleBlur}
                  disabled={savingField === 'title'}
                  style={{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    color: '#fff',
                    background: 'transparent',
                    border: '1px solid #1a1a1a',
                    borderRadius: '0',
                    padding: '4px 8px',
                    fontFamily: 'inherit',
                    flex: 1,
                    outline: 'none'
                  }}
                  placeholder="Enter title..."
                />
              ) : (
                <h1 
                  onClick={() => {
                    if (titleExpanded[activeTab]) {
                      startEdit('title', nodesData[activeTab].title || '');
                    } else {
                      setTitleExpanded(prev => ({ ...prev, [activeTab]: true }));
                      setTimeout(() => {
                        setTitleExpanded(prev => ({ ...prev, [activeTab]: false }));
                      }, 3000);
                    }
                  }}
                  style={{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    color: '#fff',
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    margin: '0',
                    borderRadius: '0',
                    background: 'transparent',
                    border: '1px solid transparent',
                    transition: 'border-color 0.2s',
                    flex: 1,
                    ...(titleExpanded[activeTab] ? {
                      whiteSpace: 'normal',
                      wordWrap: 'break-word'
                    } : {
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    })
                  }}
                  onMouseEnter={(e) => { 
                    e.currentTarget.style.borderColor = '#1a1a1a'; 
                  }}
                  onMouseLeave={(e) => { 
                    e.currentTarget.style.borderColor = 'transparent'; 
                  }}
                  title={titleExpanded[activeTab] ? undefined : (nodesData[activeTab].title || 'Untitled')}
                >
                  {nodesData[activeTab].title || 'Untitled'}
                  {savingField === 'title' && <span style={{ color: '#555', fontSize: '10px', marginLeft: '6px' }}>saving...</span>}
                </h1>
              )}

            </div>



            <div style={{ marginBottom: '16px' }}>
              <div style={{ 
                overflowX: 'auto',
                overflowY: 'visible',
                position: 'relative'
              }}>
                <DimensionTags
                dimensions={nodesData[activeTab].dimensions || []}
                priorityDimensions={priorityDimensions}
                onUpdate={async (newDimensions) => {
                  try {
                    const response = await fetch(`/api/nodes/${activeTab}`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ dimensions: newDimensions }),
                    });

                    if (!response.ok) {
                      throw new Error('Failed to save');
                    }

                    const result = await response.json();
                    if (result.node) {
                      setNodesData(prev => ({ ...prev, [activeTab]: result.node }));
                    }
                  } catch (error) {
                    console.error('Error saving dimensions:', error);
                    alert('Failed to save dimensions. Please try again.');
                  }
                }}
                onPriorityToggle={async (dimension) => {
                  try {
                    const response = await fetch('/api/dimensions/popular', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ dimension }),
                    });

                    if (!response.ok) {
                      throw new Error('Failed to toggle priority');
                    }

                    // Refresh priority dimensions list
                    await fetchPriorityDimensions();
                  } catch (error) {
                    console.error('Error toggling priority:', error);
                    alert('Failed to toggle priority. Please try again.');
                  }
                }}
                disabled={false}
              />
              </div>
            </div>


            {/* Content - Full Height Scratchpad */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{
                fontSize: '9px',
                color: '#555',
                marginBottom: '4px'
              }}>
                content
              </div>
      {editingField === 'content' ? (
                <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
                  <textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    value={editingValue}
                    onChange={handleTextareaChange}
                    onKeyDown={(e) => {
                      if (mentionActive) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, Math.max(0, mentionResults.length - 1))); return; }
                        if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                        if (e.key === 'Enter') {
                          if (mentionResults[mentionIndex]) {
                            e.preventDefault();
                            replaceMentionWithToken(mentionResults[mentionIndex].id, mentionResults[mentionIndex].title);
                            return;
                          }
                        }
                        if (e.key === 'Escape') { e.preventDefault(); resetMention(); return; }
                      }
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        saveField();
                      } else if (e.key === 'Escape') {
                        cancelEdit();
                      }
                    }}
                    onBlur={handleBlur}
                    disabled={savingField === 'content'}
                    style={{
                      color: '#e5e5e5',
                      fontSize: '16px', /* Increased from 15px for better readability */
                      lineHeight: '1.7', /* Increased from 1.6 for more comfortable reading */
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '0',
                      padding: '12px', /* Increased from 8px to 12px */
                      fontFamily: 'inherit',
                      width: '100%',
                      minHeight: '200px',
                      flex: 1,
                      resize: 'none',
                      outline: 'none',
                      overflow: 'auto'
                    }}
                    placeholder="Start writing..."
                  />
                  {mentionActive && (
                    <div style={{ position: 'absolute', bottom: 8, left: 8, right: 'auto', zIndex: 20, background: '#1a1a1a', border: '1px solid #2a2a2a', maxHeight: 180, overflowY: 'auto', width: '60%' }}>
                      {mentionQuery.trim().length < 2 ? (
                        <div style={{ padding: 6, fontSize: 11, color: '#777' }}>Type 2+ chars to search…</div>
                      ) : mentionResults.length === 0 ? (
                        <div style={{ padding: 6, fontSize: 11, color: '#777' }}>No nodes found</div>
                      ) : (
                        mentionResults.map((n, idx) => (
                          <div key={n.id}
                               onMouseDown={(e) => { e.preventDefault(); replaceMentionWithToken(n.id, n.title); }}
                               onMouseEnter={() => setMentionIndex(idx)}
                               style={{ padding: '6px 8px', fontSize: 12, color: '#ddd', cursor: 'pointer', background: idx === mentionIndex ? '#252525' : 'transparent', borderBottom: '1px solid #2a2a2a' }}>
                            <span style={{ color: '#666', marginRight: 6 }}>#{n.id}</span>
                            <span>{n.title.length > 60 ? n.title.slice(0,60) + '…' : n.title}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : nodesData[activeTab].content ? (
                <div 
                  onClick={() => startEdit('content', nodesData[activeTab].content || '')}
                  style={{
                    color: '#e5e5e5',
                    fontSize: '16px', /* Increased from 15px for better readability */
                    lineHeight: '1.7', /* Increased from 1.6 for more comfortable reading */
                    cursor: 'pointer',
                    padding: '12px', /* Increased from 8px to 12px */
                    margin: '0',
                    borderRadius: '0',
                    transition: 'all 0.2s',
                    background: 'transparent',
                    border: 'none',
                    whiteSpace: 'pre-wrap',
                    minHeight: '200px',
                    flex: 1,
                    outline: 'none'
                  }}
                >
                  {parseAndRenderContent(nodesData[activeTab].content, onNodeClick || onTabSelect)}
                  {savingField === 'content' && <span style={{ color: '#555', fontSize: '9px', marginLeft: '6px' }}>saving...</span>}
                </div>
              ) : (
                <div
                  onClick={() => startEdit('content', '')}
                  style={{
                    color: '#555',
                    fontSize: '12px',
                    fontStyle: 'italic',
                    cursor: 'pointer',
                    padding: '8px',
                    margin: '0',
                    borderRadius: '0',
                    transition: 'all 0.2s',
                    minHeight: '200px',
                    border: '1px dashed #1a1a1a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    flex: 1
                  }}
                  onMouseEnter={(e) => { 
                    e.currentTarget.style.borderColor = '#222';
                    e.currentTarget.style.color = '#666';
                  }}
                  onMouseLeave={(e) => { 
                    e.currentTarget.style.borderColor = '#1a1a1a';
                    e.currentTarget.style.color = '#555';
                  }}
                >
                  Start writing...
                </div>
              )}
            </div>

            {/* Chunk Content - Fixed at bottom */}
            <div style={{ 
              borderTop: '1px solid #1a1a1a',
              paddingTop: '16px',
              marginTop: '16px'
            }}>
              <div 
                onClick={() => setChunkExpanded(prev => ({ ...prev, [activeTab]: !prev[activeTab] }))}
                style={{
                  fontSize: '10px',
                  color: '#555',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: chunkExpanded[activeTab] ? '8px' : '0',
                  transition: 'color 0.2s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#777'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; }}
              >
                <span>{chunkExpanded[activeTab] ? '▼' : '▶'}</span>
                chunk content
              </div>
              
              {chunkExpanded[activeTab] && (
                <div>
                  {editingField === 'chunk' ? (
                    <textarea
                      ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          saveField();
                        } else if (e.key === 'Escape') {
                          cancelEdit();
                        }
                      }}
                      onBlur={handleBlur}
                      disabled={savingField === 'chunk'}
                      style={{
                        color: '#e5e5e5',
                        fontSize: '11px',
                        lineHeight: '1.4',
                        background: 'transparent',
                        border: '1px solid #1a1a1a',
                        borderRadius: '0',
                        padding: '8px',
                        fontFamily: 'inherit',
                        width: '100%',
                        minHeight: '80px',
                        resize: 'vertical',
                        outline: 'none'
                      }}
                      placeholder="Add chunk content..."
                    />
                  ) : nodesData[activeTab].chunk ? (
                    <div 
                      onClick={() => startEdit('chunk', nodesData[activeTab].chunk || '')}
                      style={{
                        color: '#ccc',
                        fontSize: '11px',
                        lineHeight: '1.4',
                        cursor: 'pointer',
                        padding: '8px',
                        background: 'transparent',
                        border: '1px solid #1a1a1a',
                        borderRadius: '0',
                        transition: 'all 0.2s',
                        whiteSpace: 'pre-wrap'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1a1a1a'; }}
                    >
                      {nodesData[activeTab].chunk}
                      {savingField === 'chunk' && <span style={{ color: '#555', fontSize: '9px', marginLeft: '6px' }}>saving...</span>}
                    </div>
                  ) : (
                    <div
                      onClick={() => startEdit('chunk', '')}
                      style={{
                        color: '#555',
                        fontSize: '11px',
                        fontStyle: 'italic',
                        cursor: 'pointer',
                        padding: '8px',
                        background: 'transparent',
                        border: '1px dashed #1a1a1a',
                        borderRadius: '0',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => { 
                        e.currentTarget.style.borderColor = '#2a2a2a';
                        e.currentTarget.style.color = '#666';
                      }}
                      onMouseLeave={(e) => { 
                        e.currentTarget.style.borderColor = '#1a1a1a';
                        e.currentTarget.style.color = '#555';
                      }}
                    >
                      Click to add chunk content...
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{
            color: '#666',
            fontSize: '13px'
          }}>
            Node not found
          </div>
        )}
      </div>
    </div>
    <ConfirmDialog
      open={pendingDeleteNodeId !== null}
      title="Delete this node?"
      message="This will permanently remove the node and its data."
      confirmLabel="Delete"
      onConfirm={handleConfirmNodeDelete}
      onCancel={handleCancelNodeDelete}
    />
    {showConnectionsModal && activeTab && (
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowConnectionsModal(false);
            setNodeSearchQuery('');
            setNodeSearchSuggestions([]);
          }
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          paddingTop: '10vh',
          zIndex: 9999,
          animation: 'backdropIn 200ms ease-out'
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '640px',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            animation: 'containerIn 200ms cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {/* Search Input */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            background: '#141414',
            border: '1px solid #262626',
            borderRadius: '16px',
            padding: '20px 24px',
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 24px 48px -12px rgba(0, 0, 0, 0.6)'
          }}>
            <svg width="22" height="22" viewBox="0 0 20 20" fill="#525252" style={{ flexShrink: 0 }}>
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input
              autoFocus
              type="text"
              value={nodeSearchQuery}
              onChange={(e) => setNodeSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowConnectionsModal(false);
                  setNodeSearchQuery('');
                  setNodeSearchSuggestions([]);
                } else {
                  handleNodeSearchKeyDown(e);
                }
              }}
              placeholder="Search to add connection..."
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#fafafa',
                fontSize: '18px',
                fontFamily: 'inherit',
                fontWeight: 400
              }}
            />
            <kbd style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 8px',
              background: '#262626',
              borderRadius: '6px',
              fontSize: '11px',
              fontFamily: 'inherit',
              color: '#737373',
              border: '1px solid #333'
            }}>
              esc
            </kbd>
          </div>

          {/* Search Results */}
          {nodeSearchSuggestions.length > 0 && (
            <div style={{
              marginTop: '8px',
              background: '#141414',
              border: '1px solid #262626',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 24px 48px -12px rgba(0, 0, 0, 0.6)',
              animation: 'resultsIn 150ms ease-out',
              maxHeight: '200px',
              overflowY: 'auto'
            }}>
              {nodeSearchSuggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id}
                  onClick={() => {
                    handleSelectNodeSuggestion(suggestion);
                    setNodeSearchQuery('');
                    setNodeSearchSuggestions([]);
                  }}
                  style={{
                    padding: '14px 20px',
                    cursor: 'pointer',
                    borderBottom: index < nodeSearchSuggestions.length - 1 ? '1px solid #1f1f1f' : 'none',
                    background: index === selectedSearchIndex ? '#1a1a1a' : 'transparent',
                    transition: 'background 100ms ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#1a1a1a';
                  }}
                  onMouseLeave={(e) => {
                    if (index !== selectedSearchIndex) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: '#0a0a0a',
                    background: '#22c55e',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    minWidth: '28px',
                    textAlign: 'center',
                    flexShrink: 0,
                    fontFamily: "'SF Mono', 'Fira Code', monospace"
                  }}>
                    #{suggestion.id}
                  </span>
                  <span style={{
                    fontSize: '14px',
                    color: '#e5e5e5',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1
                  }}>
                    {suggestion.title}
                  </span>
                  {index === selectedSearchIndex && (
                    <span style={{ color: '#525252', fontSize: '13px' }}>↵</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Empty search state */}
          {nodeSearchQuery && nodeSearchSuggestions.length === 0 && (
            <div style={{
              marginTop: '8px',
              padding: '24px',
              background: '#141414',
              border: '1px solid #262626',
              borderRadius: '16px',
              color: '#525252',
              fontSize: '14px',
              textAlign: 'center'
            }}>
              No results for "{nodeSearchQuery}"
            </div>
          )}

          {/* Existing Connections */}
          {!nodeSearchQuery && (
            <div style={{
              marginTop: '16px',
              background: '#141414',
              border: '1px solid #262626',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 8px 24px -8px rgba(0, 0, 0, 0.4)',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0
            }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid #1f1f1f',
                fontSize: '12px',
                color: '#737373',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                fontWeight: 600
              }}>
                Existing Connections ({(edgesData[activeTab] || []).length})
              </div>
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {loadingEdges.has(activeTab) ? (
                  <div style={{ padding: '24px', color: '#666', fontSize: '13px', textAlign: 'center' }}>
                    Loading...
                  </div>
                ) : (edgesData[activeTab] || []).length === 0 ? (
                  <div style={{ padding: '32px 24px', color: '#525252', fontSize: '14px', textAlign: 'center' }}>
                    No connections yet. Search above to add one.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {(edgesData[activeTab] || []).map((connection) => (
                      <div
                        key={connection.id}
                        style={{
                          padding: '14px 20px',
                          borderBottom: '1px solid #1f1f1f',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        {/* Connection header row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: '#0a0a0a',
                            background: '#22c55e',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            minWidth: '28px',
                            textAlign: 'center',
                            flexShrink: 0,
                            fontFamily: "'SF Mono', 'Fira Code', monospace"
                          }}>
                            #{connection.connected_node.id}
                          </span>
                          <span
                            onClick={() => onNodeClick?.(connection.connected_node.id)}
                            style={{
                              flex: 1,
                              fontSize: '14px',
                              color: '#e5e5e5',
                              cursor: 'pointer',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#22c55e'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#e5e5e5'; }}
                          >
                            {connection.connected_node.title}
                          </span>
                          <button
                            onClick={() => deleteEdge(connection.edge.id)}
                            disabled={deletingEdge === connection.edge.id}
                            style={{
                              padding: '6px',
                              background: 'transparent',
                              border: 'none',
                              color: '#525252',
                              cursor: deletingEdge === connection.edge.id ? 'not-allowed' : 'pointer',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease',
                              opacity: deletingEdge === connection.edge.id ? 0.5 : 1
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#1f1f1f'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#525252'; e.currentTarget.style.background = 'transparent'; }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {/* Description row */}
                        {edgeEditingId === connection.edge.id ? (
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              value={edgeEditingValue}
                              onChange={(e) => setEdgeEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  saveEdgeExplanation(connection.edge.id, connection.edge.context);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelEditEdgeExplanation();
                                }
                              }}
                              autoFocus
                              placeholder="Add explanation..."
                              style={{
                                flex: 1,
                                fontSize: '12px',
                                color: '#e5e5e5',
                                background: '#0a0a0a',
                                border: '1px solid #333',
                                borderRadius: '6px',
                                padding: '8px 10px',
                                outline: 'none',
                                fontFamily: 'inherit'
                              }}
                            />
                            <button
                              onClick={() => saveEdgeExplanation(connection.edge.id, connection.edge.context)}
                              style={{
                                padding: '6px 12px',
                                background: '#22c55e',
                                border: 'none',
                                borderRadius: '6px',
                                color: '#0a0a0a',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEditEdgeExplanation}
                              style={{
                                padding: '6px 12px',
                                background: '#262626',
                                border: 'none',
                                borderRadius: '6px',
                                color: '#999',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div
                            onClick={() => startEditEdgeExplanation(connection.edge.id, connection.edge.context?.explanation as string | undefined)}
                            style={{
                              fontSize: '12px',
                              color: connection.edge.context?.explanation ? '#888' : '#525252',
                              cursor: 'pointer',
                              padding: '4px 0',
                              fontStyle: connection.edge.context?.explanation ? 'normal' : 'italic'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#aaa'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = connection.edge.context?.explanation ? '#888' : '#525252'; }}
                          >
                            {(connection.edge.context?.explanation as string) || 'Click to add explanation...'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <style jsx>{`
          @keyframes backdropIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes containerIn {
            from { 
              opacity: 0;
              transform: scale(0.96) translateY(-8px);
            }
            to { 
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }
          @keyframes resultsIn {
            from { 
              opacity: 0;
              transform: translateY(-4px);
            }
            to { 
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
    )}

  </>
  );
}
