"use client";

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface DimensionSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDimensionSelect: (dimension: string) => void;
  existingDimensions: string[];
}

interface DimensionSuggestion {
  dimension: string;
  count: number;
  isPriority: boolean;
}

export default function DimensionSearchModal({ 
  isOpen, 
  onClose, 
  onDimensionSelect,
  existingDimensions 
}: DimensionSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DimensionSuggestion[]>([]);
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

  // Fetch dimension suggestions
  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const response = await fetch('/api/dimensions/popular?limit=50');
        const result = await response.json();
        
        if (result.success) {
          const allDimensions: DimensionSuggestion[] = result.data;
          
          // Filter based on search query and exclude existing dimensions
          const filtered = allDimensions.filter(dim => {
            const matchesQuery = !searchQuery.trim() || 
              dim.dimension.toLowerCase().includes(searchQuery.toLowerCase());
            const notExisting = !existingDimensions.includes(dim.dimension);
            return matchesQuery && notExisting;
          });
          
          // Sort: priority first, then by count
          const sorted = filtered.sort((a, b) => {
            if (a.isPriority && !b.isPriority) return -1;
            if (!a.isPriority && b.isPriority) return 1;
            return b.count - a.count;
          });
          
          setSuggestions(sorted.slice(0, 20));
          setSelectedIndex(0);
        }
      } catch (error) {
        console.error('Error fetching dimension suggestions:', error);
        setSuggestions([]);
      }
    };

    if (isOpen) {
      const timeoutId = setTimeout(fetchSuggestions, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [searchQuery, existingDimensions, isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      
      if (suggestions[selectedIndex]) {
        // Select existing dimension
        handleSelectDimension(suggestions[selectedIndex].dimension);
      } else if (searchQuery.trim()) {
        // Create new dimension
        handleSelectDimension(searchQuery.trim());
      }
    }
  };

  const handleSelectDimension = (dimension: string) => {
    onDimensionSelect(dimension);
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

  const canCreateNew = searchQuery.trim() && 
    !suggestions.some(s => s.dimension.toLowerCase() === searchQuery.toLowerCase());

  const modalContent = (
    <div
      className="search-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Search dimensions"
    >
      <div ref={modalRef} className="search-container">
        {/* Search Input */}
        <div className="search-input-wrapper">
          <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
          
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or create dimension..."
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
                key={suggestion.dimension}
                onClick={() => handleSelectDimension(suggestion.dimension)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`search-result-item ${index === selectedIndex ? 'selected' : ''}`}
              >
                <span className={`result-name ${suggestion.isPriority ? 'priority' : ''}`}>
                  {suggestion.dimension}
                </span>
                <span className="result-count">{suggestion.count}</span>
                {index === selectedIndex && (
                  <span className="result-hint">↵</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Create New Option */}
        {canCreateNew && (
          <div className="search-create">
            <button
              onClick={() => handleSelectDimension(searchQuery.trim())}
              onMouseEnter={() => setSelectedIndex(suggestions.length)}
              className={`create-button ${selectedIndex === suggestions.length ? 'selected' : ''}`}
            >
              <span className="create-icon">+</span>
              Create "{searchQuery.trim()}"
            </button>
          </div>
        )}

        {/* Empty state */}
        {!searchQuery && suggestions.length === 0 && (
          <div className="search-empty">
            Start typing to search dimensions
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
        
        .result-name {
          flex: 1;
          color: #e5e5e5;
          font-size: 15px;
        }
        
        .result-name.priority {
          color: #22c55e;
        }
        
        .result-count {
          color: #525252;
          font-size: 12px;
          font-family: 'SF Mono', 'Fira Code', monospace;
        }
        
        .result-hint {
          color: #525252;
          font-size: 13px;
        }
        
        .search-create {
          margin-top: 8px;
          background: #141414;
          border: 1px solid #262626;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 
            0 0 0 1px rgba(255, 255, 255, 0.04),
            0 24px 48px -12px rgba(0, 0, 0, 0.6);
        }
        
        .create-button {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          background: transparent;
          border: none;
          cursor: pointer;
          transition: background 100ms ease;
          text-align: left;
          font-family: inherit;
          color: #22c55e;
          font-size: 15px;
        }
        
        .create-button:hover,
        .create-button.selected {
          background: #1a1a1a;
        }
        
        .create-icon {
          font-size: 18px;
          font-weight: 300;
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
