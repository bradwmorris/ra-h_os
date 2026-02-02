import { getSQLiteClient } from './sqlite-client';
import { openai as openaiProvider } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { hasValidOpenAiKey } from './descriptionService';

export interface Dimension {
  name: string;
  description: string | null;
  is_priority: boolean;
  updated_at: string;
}

export interface LockedDimension {
  name: string;
  description: string | null;
  count: number;
}

export class DimensionService {
  /**
   * Get all locked (priority) dimensions with their descriptions
   */
  static async getLockedDimensions(): Promise<LockedDimension[]> {
    const sqlite = getSQLiteClient();
    
    const result = sqlite.query(`
      WITH dimension_counts AS (
        SELECT nd.dimension, COUNT(*) AS count 
        FROM node_dimensions nd 
        GROUP BY nd.dimension
      )
      SELECT 
        d.name,
        d.description,
        COALESCE(dc.count, 0) AS count
      FROM dimensions d
      LEFT JOIN dimension_counts dc ON dc.dimension = d.name
      WHERE d.is_priority = 1
      ORDER BY d.name ASC
    `);

    return result.rows.map((row: any) => ({
      name: row.name,
      description: row.description,
      count: Number(row.count)
    }));
  }

  /**
   * Automatically assign locked dimensions + suggest keyword dimensions
   * Returns { locked: string[], keywords: string[] }
   *
   * IMPORTANT: Returns empty result immediately if no valid API key is configured.
   * This prevents slow node creation when OpenAI is unavailable.
   */
  static async assignDimensions(nodeData: {
    title: string;
    content?: string;
    link?: string;
    description?: string;
  }): Promise<{ locked: string[]; keywords: string[] }> {
    // Fast path: skip AI if no valid API key
    if (!hasValidOpenAiKey()) {
      console.log(`[DimensionAssignment] No valid OpenAI key, skipping for: "${nodeData.title}"`);
      return { locked: [], keywords: [] };
    }

    try {
      const lockedDimensions = await this.getLockedDimensions();

      if (lockedDimensions.length === 0) {
        console.log('[DimensionAssignment] No locked dimensions available');
        return { locked: [], keywords: [] };
      }

      const prompt = this.buildAssignmentPrompt(nodeData, lockedDimensions);

      console.log(`[DimensionAssignment] Processing: "${nodeData.title}"`);

      const response = await generateText({
        model: openaiProvider('gpt-4o-mini'),
        prompt,
        maxOutputTokens: 300, // Increased to accommodate more dimensions
        temperature: 0.1,
      });

      console.log(`[DimensionAssignment] AI Response:\n${response.text}`);

      const result = this.parseAssignmentResponse(response.text, lockedDimensions);

      console.log(`[DimensionAssignment] Locked: ${result.locked.join(', ') || 'none'}`);
      console.log(`[DimensionAssignment] Keywords: ${result.keywords.join(', ') || 'none'}`);

      return result;

    } catch (error) {
      console.error('[DimensionAssignment] Error:', error);
      return { locked: [], keywords: [] };
    }
  }

  /**
   * Legacy method for backwards compatibility
   * @deprecated Use assignDimensions() instead
   */
  static async assignLockedDimensions(nodeData: {
    title: string;
    content?: string;
    link?: string;
  }): Promise<string[]> {
    const result = await this.assignDimensions(nodeData);
    return result.locked;
  }

  /**
   * Update dimension description
   */
  static async updateDimensionDescription(name: string, description: string): Promise<void> {
    const sqlite = getSQLiteClient();
    
    sqlite.query(`
      INSERT INTO dimensions(name, description, is_priority, updated_at) 
      VALUES (?, ?, 0, CURRENT_TIMESTAMP) 
      ON CONFLICT(name) DO UPDATE SET 
        description = ?, 
        updated_at = CURRENT_TIMESTAMP
    `, [name, description, description]);
  }

  /**
   * Get dimension by name with description
   */
  static async getDimensionByName(name: string): Promise<Dimension | null> {
    const sqlite = getSQLiteClient();
    
    const result = sqlite.query(`
      SELECT name, description, is_priority, updated_at 
      FROM dimensions 
      WHERE name = ?
    `, [name]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as any;
    return {
      name: row.name,
      description: row.description,
      is_priority: Boolean(row.is_priority),
      updated_at: row.updated_at
    };
  }

  /**
   * Build AI prompt for dimension assignment (locked dimensions only)
   */
  private static buildAssignmentPrompt(
    nodeData: { title: string; content?: string; link?: string; description?: string },
    lockedDimensions: LockedDimension[]
  ): string {
    // Use description as primary context, content as fallback
    let nodeContextSection: string;
    if (nodeData.description) {
      const contentPreview = nodeData.content?.slice(0, 500) || '';
      nodeContextSection = `DESCRIPTION: ${nodeData.description}

CONTENT PREVIEW: ${contentPreview}${nodeData.content && nodeData.content.length > 500 ? '...' : ''}`;
    } else {
      const contentPreview = nodeData.content?.slice(0, 2000) || '';
      nodeContextSection = `CONTENT: ${contentPreview}${nodeData.content && nodeData.content.length > 2000 ? '...' : ''}`;
    }

    // Include ALL locked dimensions, using fallback text for those without descriptions
    const dimensionsList = lockedDimensions
      .map(d => {
        const description = d.description && d.description.trim().length > 0
          ? d.description
          : '(none - infer from name)';
        return `DIMENSION: "${d.name}"\nDESCRIPTION: ${description}`;
      })
      .join('\n---\n');

    return `You are categorizing a knowledge node into locked dimensions.

=== NODE TO CATEGORIZE ===
Title: ${nodeData.title}
${nodeContextSection}
URL: ${nodeData.link || 'none'}

=== LOCKED DIMENSIONS ===
CRITICAL: Read each dimension's DESCRIPTION carefully.
The description defines what belongs in that dimension.
Only assign if the content CLEARLY matches the description.
If unsure, skip it — better to miss than assign incorrectly.

AVAILABLE DIMENSIONS:
${dimensionsList}

=== RESPONSE FORMAT ===
LOCKED:
[dimension names from the list above, one per line, or "none"]`;
  }

  /**
   * Parse AI response and extract locked dimensions
   */
  private static parseAssignmentResponse(
    response: string,
    availableDimensions: LockedDimension[]
  ): { locked: string[]; keywords: string[] } {
    const lockedDimensions: string[] = [];

    // Extract LOCKED section
    const lockedMatch = response.match(/LOCKED:\s*([\s\S]*?)$/i);

    if (lockedMatch) {
      const lockedLines = lockedMatch[1].trim().split('\n');
      for (const line of lockedLines) {
        const dimensionName = line.trim().toLowerCase();

        if (dimensionName === 'none' || dimensionName === '') {
          continue;
        }

        // Find matching dimension (case-insensitive)
        const matchedDimension = availableDimensions.find(
          d => d.name.toLowerCase() === dimensionName
        );

        if (matchedDimension && !lockedDimensions.includes(matchedDimension.name)) {
          lockedDimensions.push(matchedDimension.name);
        }
      }
    }

    return { locked: lockedDimensions, keywords: [] };
  }

  /**
   * Create or get a keyword dimension (unlocked)
   */
  static async ensureKeywordDimension(keyword: string): Promise<void> {
    const sqlite = getSQLiteClient();

    // INSERT OR IGNORE - if dimension exists, do nothing
    sqlite.query(`
      INSERT OR IGNORE INTO dimensions(name, description, is_priority, updated_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    `, [keyword, null]);
  }
}

export const dimensionService = new DimensionService();