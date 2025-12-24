"use client";

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Chip from '../common/Chip';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNodeSelect: (nodeId: number) => void;
  existingFilters: {type: 'dimension' | 'title', value: string}[];
}

interface NodeSuggestion {
  id: number;
  title: string;
  dimensions?: string[];
}

export default function SearchModal({ isOpen, onClose, onNodeSelect, existingFilters }: SearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NodeSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Store the element that triggered the modal for return focus
  useEffect(() => {
    if (isOpen && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
  }, [isOpen]);

  // Focus trap and accessibility
  useEffect(() => {
    if (!isOpen) return;

    // Autofocus input
    inputRef.current?.focus();

    // Lock body scroll
    document.body.style.overflow = 'hidden';

    // Handle Escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    // Focus trap: keep focus within modal
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      
      const focusableElements = modalRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      
      if (!focusableElements || focusableElements.length === 0) return;
      
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleTab);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', handleTab);
      
      // Return focus to trigger element
      if (returnFocusRef.current) {
        returnFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  // Generate suggestions based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      return;
    }

    const fetchSuggestions = async () => {
      try {
        const response = await fetch(`/api/nodes/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
        const result = await response.json();
        
        if (result.success) {
          const nodeSuggestions: NodeSuggestion[] = result.data.map((node: any) => ({
            id: node.id,
            title: node.title,
            dimensions: node.dimensions || []
          }));
          
          setSuggestions(nodeSuggestions);
          setSelectedIndex(0);
        }
      } catch (error) {
        console.error('Error fetching suggestions:', error);
        setSuggestions([]);
      }
    };

    const timeoutId = setTimeout(fetchSuggestions, 200);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, existingFilters]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && suggestions[selectedIndex]) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[selectedIndex]);
    }
  };

  const handleSelectSuggestion = (suggestion: NodeSuggestion) => {
    onNodeSelect(suggestion.id);
    setSearchQuery('');
    setSuggestions([]);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="search-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Search nodes"
    >
      <div ref={modalRef} className="search-container">
        {/* Search Input */}
        <div className="search-input-wrapper">
          <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
          
          {/* Selected Filters */}
          {existingFilters.map((filter, index) => (
            <Chip
              key={index}
              label={filter.value}
              color={'#1a1a4d'}
              maxWidth={120}
            />
          ))}
          
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={existingFilters.length === 0 ? "Search nodes..." : ""}
            className="search-input"
          />
          
          <div className="search-shortcut">
            <kbd>esc</kbd>
          </div>
        </div>

        {/* Results */}
        {suggestions.length > 0 && (
          <div className="search-results">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                onClick={() => handleSelectSuggestion(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`search-result-item ${index === selectedIndex ? 'selected' : ''}`}
              >
                <span className="result-id">#{suggestion.id}</span>
                <span className="result-title">{suggestion.title}</span>
                {index === selectedIndex && (
                  <span className="result-hint">↵</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {searchQuery && suggestions.length === 0 && (
          <div className="search-empty">
            No results for "{searchQuery}"
          </div>
        )}
      </div>

      <style jsx>{`
        .search-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(8px);
          display: flex;
          justify-content: center;
          padding-top: 15vh;
          z-index: 9999;
          animation: backdropIn 200ms ease-out;
        }
        
        .search-container {
          width: 100%;
          max-width: 640px;
          max-height: 70vh;
          animation: containerIn 200ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        .search-input-wrapper {
          display: flex;
          align-items: center;
          gap: 16px;
          background: #141414;
          border: 1px solid #262626;
          border-radius: 16px;
          padding: 20px 24px;
          box-shadow: 
            0 0 0 1px rgba(255, 255, 255, 0.04),
            0 24px 48px -12px rgba(0, 0, 0, 0.6);
        }
        
        .search-icon {
          width: 22px;
          height: 22px;
          color: #525252;
          flex-shrink: 0;
        }
        
        .search-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          color: #fafafa;
          font-size: 18px;
          font-family: inherit;
          font-weight: 400;
        }
        
        .search-input::placeholder {
          color: #525252;
        }
        
        .search-shortcut {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .search-shortcut kbd {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 8px;
          background: #262626;
          border-radius: 6px;
          font-size: 11px;
          font-family: inherit;
          color: #737373;
          border: 1px solid #333;
        }
        
        .search-results {
          margin-top: 8px;
          background: #141414;
          border: 1px solid #262626;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 
            0 0 0 1px rgba(255, 255, 255, 0.04),
            0 24px 48px -12px rgba(0, 0, 0, 0.6);
          animation: resultsIn 150ms ease-out;
        }
        
        .search-result-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 20px;
          background: transparent;
          border: none;
          border-bottom: 1px solid #1f1f1f;
          cursor: pointer;
          transition: background 100ms ease;
          text-align: left;
          font-family: inherit;
        }
        
        .search-result-item:last-child {
          border-bottom: none;
        }
        
        .search-result-item:hover,
        .search-result-item.selected {
          background: #1a1a1a;
        }
        
        .result-id {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 600;
          font-family: 'SF Mono', 'Fira Code', monospace;
          color: #0a0a0a;
          background: #22c55e;
          padding: 4px 8px;
          border-radius: 6px;
          min-width: 28px;
          flex-shrink: 0;
        }
        
        .result-title {
          flex: 1;
          color: #e5e5e5;
          font-size: 15px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .result-hint {
          color: #525252;
          font-size: 13px;
        }
        
        .search-empty {
          margin-top: 8px;
          padding: 32px 24px;
          background: #141414;
          border: 1px solid #262626;
          border-radius: 16px;
          color: #525252;
          font-size: 14px;
          text-align: center;
        }
        
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
  );

  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
