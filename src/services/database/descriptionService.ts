import { openai as openaiProvider } from '@ai-sdk/openai';
import { generateText } from 'ai';

export interface DescriptionInput {
  title: string;
  content?: string;
  link?: string;
  metadata?: {
    source?: string;
    channel_name?: string;
    author?: string;
    site_name?: string;
  };
  type?: string;
  dimensions?: string[];
}

/**
 * Check if we have a valid OpenAI API key configured.
 * Checks both environment variable and validates format.
 */
export function hasValidOpenAiKey(): boolean {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'your-openai-api-key-here') return false;
  // Valid OpenAI keys start with sk- or sk-proj-
  return key.startsWith('sk-') && key.length > 20;
}

/**
 * Generate a simple fallback description without AI.
 * Used when no API key is available or for simple inputs.
 */
export function generateFallbackDescription(input: DescriptionInput): string {
  const { title, type, metadata, dimensions } = input;

  // Build a contextual fallback
  const parts: string[] = [];

  if (metadata?.author || metadata?.channel_name) {
    parts.push(`By ${metadata.author || metadata.channel_name}`);
  }

  if (type) {
    parts.push(type.charAt(0).toUpperCase() + type.slice(1));
  }

  if (dimensions?.length) {
    parts.push(`in ${dimensions.slice(0, 2).join(', ')}`);
  }

  if (parts.length > 0) {
    return `${parts.join(' — ')}: ${title.slice(0, 200)}`;
  }

  return `Knowledge item: ${title.slice(0, 250)}`;
}

/**
 * Generate a 280-character description for a knowledge node.
 * Contextually grounded - adapts to node type (person, concept, article, etc.)
 *
 * IMPORTANT: Returns fallback immediately if no valid API key is configured.
 * This prevents slow node creation (9-13s timeout) when OpenAI is unavailable.
 */
export async function generateDescription(input: DescriptionInput): Promise<string> {
  // Fast path: skip AI if no valid API key
  if (!hasValidOpenAiKey()) {
    console.log(`[DescriptionService] No valid OpenAI key, using fallback for: "${input.title}"`);
    return generateFallbackDescription(input);
  }

  // Fast path: skip AI for very short inputs (likely just notes)
  if (!input.content && !input.link && input.title.length < 30) {
    console.log(`[DescriptionService] Short input, using fallback for: "${input.title}"`);
    return generateFallbackDescription(input);
  }

  try {
    const prompt = buildDescriptionPrompt(input);

    console.log(`[DescriptionService] Generating description for: "${input.title}"`);

    const response = await generateText({
      model: openaiProvider('gpt-4o-mini'),
      prompt,
      maxOutputTokens: 100,
      temperature: 0.3,
    });

    const description = response.text.trim();

    // Ensure within character limit
    const finalDescription = description.slice(0, 280);

    console.log(`[DescriptionService] Generated: "${finalDescription}"`);

    return finalDescription;
  } catch (error) {
    console.error('[DescriptionService] Error generating description:', error);
    // Return a fallback description
    return generateFallbackDescription(input);
  }
}

function buildDescriptionPrompt(input: DescriptionInput): string {
  const normalizedSource = (input.metadata?.source || '').toLowerCase();
  const url = typeof input.link === 'string' ? input.link.trim() : '';

  // Best-effort creator hint from structured metadata (when available),
  // but never assume a particular extraction source (YouTube vs paper vs website vs note).
  const creatorHint =
    input.metadata?.author?.trim() ||
    input.metadata?.channel_name?.trim() ||
    '';

  // Best-effort publisher / container hint (less ideal than a true author, but better than nothing).
  const publisherHint = input.metadata?.site_name?.trim() || '';

  const likelyExternal =
    Boolean(url) ||
    normalizedSource.includes('youtube') ||
    normalizedSource.includes('extract') ||
    normalizedSource.includes('paper') ||
    normalizedSource.includes('pdf') ||
    normalizedSource.includes('website');

  const likelyUserAuthored =
    !likelyExternal &&
    (normalizedSource.includes('quick-add-note') ||
      normalizedSource.includes('quick-add-chat') ||
      normalizedSource.includes('note') ||
      normalizedSource.length === 0);

  const lines: string[] = [`Title: ${input.title}`];

  if (input.link) lines.push(`URL: ${input.link}`);
  if (input.dimensions?.length) lines.push(`Dimensions: ${input.dimensions.join(', ')}`);
  if (input.metadata?.channel_name) lines.push(`Channel: ${input.metadata.channel_name}`);
  if (input.metadata?.author) lines.push(`Author: ${input.metadata.author}`);
  if (input.metadata?.site_name) lines.push(`Site: ${input.metadata.site_name}`);
  if (creatorHint) lines.push(`Creator hint: ${creatorHint}`);
  if (publisherHint) lines.push(`Publisher hint: ${publisherHint}`);
  lines.push(`Likely user-authored: ${likelyUserAuthored ? 'yes' : 'no'}`);

  const contentPreview = input.content?.slice(0, 800) || '';
  if (contentPreview) lines.push(`Content: ${contentPreview}${input.content && input.content.length > 800 ? '...' : ''}`);

  return `Your job is to answer: "what is this?" in one short line. Max 280 characters.

GOAL: Include "who created it" when possible.

RULES (in priority order):
1) ONLY use a creator if you have a creator hint (Author/Channel) or the content explicitly says "by <X>" / "hosted by <X>".
   - Do NOT treat prominent people in the title/transcript (e.g. a guest) as the creator.
   - If a creator hint is provided, prefer it.
2) If you can identify a creator/author/channel/person/org from a creator hint, start with: "By <creator> — ..."
3) If it's likely user-authored, start with: "Your <thing> — ..." (don't invent a creator name).
4) If creator is unknown, do NOT guess; omit the byline.

Then, in the remainder, state what it is (video/paper/article/note/idea/etc) + what it's about (high-signal).
If unsure, say so briefly.

${lines.join('\n')}`;
}

export const descriptionService = {
  generateDescription
};
