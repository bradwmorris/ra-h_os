"use client";

import { useState } from 'react';
import {
  Video,
  FileText,
  File,
  Globe,
  BookOpen,
  BookMarked,
  Bug,
  ChefHat,
  FolderKanban,
  Gavel,
  History,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Network,
  Puzzle,
  Scale,
  ScrollText,
  SearchCheck,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  User,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Node } from '@/types/database';
import { normalizeNodeLink } from '@/utils/nodeLink';

const ICON_COLOR = '#94a3b8';

/**
 * Icon per `metadata.type` for nodes without a link, so notes of different kinds are
 * distinguishable at a glance (and when the map collapses nodes to their icons).
 * Keys are lower-case; `-` and `_` are treated the same.
 */
const TYPE_ICONS: Record<string, LucideIcon> = {
  reference: BookOpen,
  feedback: MessageSquare,
  preference: SlidersHorizontal,
  convention: Scale,
  rule: Gavel,
  'business-rule': Gavel,
  policy: ShieldCheck,
  project: FolderKanban,
  'project-history': History,
  person: User,
  incident: TriangleAlert,
  'root-cause': Bug,
  finding: SearchCheck,
  gotcha: Zap,
  'design-decision': Lightbulb,
  process: ListChecks,
  runbook: BookMarked,
  recipe: ChefHat,
  topology: Network,
  skill: Wrench,
  pattern: Shapes,
  memory: ScrollText,
  integration: Puzzle,
};

export function typeIcon(type: unknown): LucideIcon | null {
  if (typeof type !== 'string') return null;
  const key = type.trim().toLowerCase().replace(/_/g, '-');
  // Own keys only: inherited names such as "constructor" or "__proto__" must fall
  // through to the default icon rather than return a non-component.
  return Object.prototype.hasOwnProperty.call(TYPE_ICONS, key) ? TYPE_ICONS[key] : null;
}

interface FaviconIconProps {
  domain: string;
  size?: number;
}

const FaviconIcon = ({ domain, size = 16 }: FaviconIconProps) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Globe size={size} color="#94a3b8" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`}
      width={size}
      height={size}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
};

/**
 * Resolve the icon for a node.
 *
 * Priority:
 * 1. URL-derived icon (favicon, YouTube, PDF) — if node has a link
 * 2. Icon for the node's metadata.type (reference, convention, project, ...)
 * 3. Fallback to generic File icon
 *
 * @param node - The database node
 * @param size - Icon size in px (default 16)
 */
export function getNodeIcon(
  node: Node,
  size: number = 16,
): React.ReactElement {
  // If node has a link, use URL-derived icon (primary)
  if (node.link) {
    const normalizedLink = normalizeNodeLink(node.link);
    const url = (normalizedLink || node.link).toLowerCase();

    // YouTube videos
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return <Video size={size} color="#FF0000" />;
    }

    // PDFs and papers
    if (url.endsWith('.pdf') || node.metadata?.type === 'paper') {
      return <FileText size={size} color="#94a3b8" />;
    }

    // Website favicon with graceful fallback
    try {
      const domain = new URL(normalizedLink || node.link).hostname;
      return <FaviconIcon domain={domain} size={size} />;
    } catch {
      return <Globe size={size} color="#94a3b8" />;
    }
  }

  const TypeIcon = typeIcon(node.metadata?.type);
  if (TypeIcon) {
    return <TypeIcon size={size} color={ICON_COLOR} />;
  }

  // Fallback
  return <File size={size} color={ICON_COLOR} />;
}
