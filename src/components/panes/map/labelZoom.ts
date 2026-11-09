import { createContext } from 'react';

/**
 * Zoom level below which less prominent map nodes collapse to their icon. The map sets
 * it just under the zoom it fits the view to, so every label shows at the default
 * (fitted) view and when zoomed in, and nodes only collapse when you zoom out further.
 * 0 means never collapse (used until the first fit has happened).
 */
export const CompactBelowZoomContext = createContext(0);

/** Labels stay visible down to this fraction of the fitted zoom. */
export const FIT_LABEL_MARGIN = 0.85;
