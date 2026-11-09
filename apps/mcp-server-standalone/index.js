#!/usr/bin/env node
'use strict';

// Check Node version early — better-sqlite3 v13 (N-API) requires Node 22+
const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion < 22) {
  console.error(`[ra-h-mcp-server] ERROR: Node.js v${process.versions.node} is not supported.`);
  console.error('[ra-h-mcp-server] Node 22 or newer is required. Install a current LTS:');
  console.error('[ra-h-mcp-server]   nvm install --lts && nvm use --lts');
  console.error('[ra-h-mcp-server]   or: brew install node');
  process.exit(1);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error('[ra-h-mcp-server] ERROR: Failed to load better-sqlite3 native module.');
  console.error(`[ra-h-mcp-server] Node version: ${process.versions.node}`);
  console.error('[ra-h-mcp-server] This usually means the native bindings need rebuilding:');
  console.error('[ra-h-mcp-server]   npm rebuild better-sqlite3');
  console.error('[ra-h-mcp-server] If no prebuilt binary exists for your platform, install build tools (python3, make, a C++ compiler) and retry.');
  console.error('[ra-h-mcp-server] Original error:', err.message);
  process.exit(1);
}

const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const packageJson = require('./package.json');

const { initDatabase, getDatabasePath, closeDatabase, getDb, query } = require('./services/sqlite-client');
const nodeService = require('./services/nodeService');
const edgeService = require('./services/edgeService');
const skillService = require('./services/skillService');
const retrievalService = require('./services/retrievalService');
const { directNodeLookup } = require('./services/directNodeLookupService');

const cliCommands = new Set(['setup', 'doctor', 'init-db', 'print-config', 'install-rules', '--help', '-h']);
if (cliCommands.has(process.argv[2])) {
  const { runCli } = require('./cli');
  runCli(process.argv.slice(2));
  process.exit(0);
}

// Server info
const serverInfo = {
  name: 'ra-h-standalone',
  version: packageJson.version
};

function buildInstructions() {
  const now = new Date().toISOString().split('T')[0];
  let skillIndex = [
    '- onboarding: Bootstrap a useful starter graph quickly and with low friction.',
    '- create-skill: Create or rewrite a reusable skill when a workflow is repeatable.',
    '- refine: Clean up or sharpen one node or a small set of nodes before writing changes.'
  ].join('\n');

  try {
    const skills = skillService.listSkills();
    if (Array.isArray(skills) && skills.length > 0) {
      skillIndex = skills
        .map(s => `- ${s.name}: ${s.description}`)
        .join('\n');
    }
  } catch (error) {
    log('Warning: failed to load skill index for instructions:', error.message);
  }

  return `Today's date: ${now}. RA-H is the user's personal knowledge graph — local SQLite, fully on-device.

## Quick start
1. If the user is trying to find a specific existing node, call queryNodes first.
2. If graph context would help with a broader task, call retrieveQueryContext before answering.
3. Call getContext only when orientation about the overall graph would actually help.
4. Do not keep re-running retrieval if you already have enough relevant graph context in play.
5. Search before creating, and prefer updateNode when the artifact is clearly the same thing.
6. For simple tasks, tool descriptions should be enough.
7. For non-trivial workflows or policy detail, call readSkill on the matching skill.

## Knowledge capture
Only suggest saving durable knowledge when it seems unusually durable and valuable.
Keep the ask brief: Add "X" as a node?
Do not pester. Do not keep re-asking if the user says no, ignores it, or moves on.
Do not create edges autonomously. Surface likely edge candidates briefly, then call edge-write tools only after the user explicitly confirms.
Always search or retrieve before creating to avoid duplicates.

## Available skills
${skillIndex}
Load any skill with readSkill("name").

All data stays on this device.`;
}

// Tool schemas
const addNodeInputSchema = {
  title: z.string().min(1).max(160).describe('Clear, descriptive title'),
  content: z.string().max(20000).optional().describe('Legacy alias for source content'),
  source: z.string().max(50000).optional().describe('Canonical source content for embedding'),
  link: z.string().url().optional().describe('Source URL'),
  description: z.string().optional().describe('Strongly recommended. Write the description as natural prose, not labels or a checklist. It should make clear what the artifact is and any surrounding context available. RA-H will accept whatever description is provided and will not block the write.'),
  metadata: z.record(z.any()).optional().describe('Optional metadata. Prefer canonical keys: type, state, captured_method, captured_by, source_metadata.'),
  chunk: z.string().max(50000).optional().describe('Legacy alias for source text')
};

const searchNodesInputSchema = {
  query: z.string().min(1).max(400).describe('Search query'),
  limit: z.number().min(1).max(50).optional().describe('Max results (default 10)'),
  created_after: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes created on or after this date.'),
  created_before: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes created before this date.'),
  event_after: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes with event_date on or after this date.'),
  event_before: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes with event_date before this date.')
};

const retrieveQueryContextInputSchema = {
  query: z.string().min(1).max(800).describe('The raw user query for this turn'),
  focused_node_id: z.number().int().positive().nullable().optional().describe('Optional currently focused node ID'),
  limit: z.number().min(1).max(12).optional().describe('Maximum number of nodes to return')
};

const getNodesInputSchema = {
  nodeIds: z.array(z.number().int().positive()).min(1).max(10).describe('Node IDs to load')
};

const updateNodeInputSchema = {
  id: z.number().int().positive().describe('Node ID'),
  updates: z.object({
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('Recommended replacement description. Keep it as natural prose that says what this artifact is and any surrounding context available. RA-H will accept whatever description is provided and will not block the write.'),
    content: z.string().optional().describe('Legacy alias for source'),
    source: z.string().optional().describe('Canonical source content for embedding'),
    link: z.string().optional().describe('New link'),
    metadata: z.record(z.any()).optional().describe('Metadata patch. It now merges with existing metadata. Prefer canonical keys: type, state, captured_method, captured_by, source_metadata.')
  }).describe('Fields to update')
};

const createEdgeInputSchema = {
  sourceId: z.number().int().positive().describe("The 'subject' node (reads: source [explanation] target)"),
  targetId: z.number().int().positive().describe('Target node ID'),
  explanation: z.string().min(1).describe("Human-readable explanation. Should read as a sentence: 'Alice invented this technique'"),
  confirmed_by_user: z.boolean().describe('Must be true. Only create the edge after the user explicitly confirmed this proposed relationship.')
};

const updateEdgeInputSchema = {
  id: z.number().int().positive().describe('Edge ID'),
  explanation: z.string().min(1).describe('Updated explanation for this connection'),
  confirmed_by_user: z.boolean().describe('Must be true. Only update the edge after the user explicitly confirmed the corrected relationship.')
};

const queryEdgesInputSchema = {
  nodeId: z.number().int().positive().optional().describe('Find edges for this node'),
  limit: z.number().min(1).max(50).optional().describe('Max edges (default 25)')
};

const readSkillInputSchema = {
  name: z.string().min(1).describe('Skill name (e.g. "onboarding", "create-skill", "refine")')
};

const writeSkillInputSchema = {
  name: z.string().min(1).describe('Skill name (lowercase, no spaces)'),
  content: z.string().min(1).describe('Full markdown content including YAML frontmatter (name, description)')
};

const deleteSkillInputSchema = {
  name: z.string().min(1).describe('Skill name to delete')
};

const searchContentInputSchema = {
  query: z.string().min(1).max(400).describe('Search text'),
  node_id: z.number().int().positive().optional().describe('Scope to a specific node\'s chunks'),
  limit: z.number().min(1).max(20).optional().describe('Max results (default 5)')
};

const sqliteQueryInputSchema = {
  sql: z.string().min(1).describe('The SQL query to execute. Must be a SELECT, WITH, or PRAGMA statement.'),
  format: z.enum(['json', 'table']).optional().describe('Output format (default json)')
};

// FTS5 helpers
function sanitizeFtsQuery(input) {
  return input
    .replace(/['"()*:^~{}[\]]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0 && !/^(AND|OR|NOT|NEAR)$/i.test(w))
    .join(' ');
}

let _ftsAvailability = null;

function checkFtsAvailability() {
  if (_ftsAvailability !== null) return _ftsAvailability;
  try {
    const db = getDb();
    const nodesFts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'").get();
    const chunksFts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get();
    _ftsAvailability = { nodes: !!nodesFts, chunks: !!chunksFts };
  } catch {
    _ftsAvailability = { nodes: false, chunks: false };
  }
  return _ftsAvailability;
}

// Security: Only allow read-only SQL statements
function isReadOnlyQuery(sql) {
  const normalized = sql.trim().toLowerCase();

  const allowedPrefixes = ['select', 'with', 'pragma'];
  const startsWithAllowed = allowedPrefixes.some(prefix =>
    normalized.startsWith(prefix)
  );

  if (!startsWithAllowed) return false;

  const dangerousPatterns = [
    /\binsert\b/i,
    /\bupdate\b/i,
    /\bdelete\b/i,
    /\bdrop\b/i,
    /\bcreate\b/i,
    /\balter\b/i,
    /\battach\b/i,
    /\bdetach\b/i,
    /\breindex\b/i,
    /\bvacuum\b/i,
    /\banalyze\b/i,
  ];

  return !dangerousPatterns.some(pattern => pattern.test(sql));
}

// Log to stderr (stdout is reserved for MCP protocol)
function log(...args) {
  console.error('[ra-h-standalone]', ...args);
}

function withVisibleJson(summary, payload) {
  return `${summary}\n\n${JSON.stringify(payload, null, 2)}`;
}

async function main() {
  // Initialize database
  try {
    initDatabase();
    log('Database connected:', getDatabasePath());
  } catch (error) {
    log('ERROR:', error.message);
    process.exit(1);
  }

  const instructions = buildInstructions();
  const server = new McpServer(serverInfo, { instructions });

  function registerToolWithAliases(name, config, handler) {
    server.registerTool(name, config, handler);
  }

  // ========== CONTEXT TOOL ==========

  registerToolWithAliases(
    'getContext',
    {
      title: 'Get RA-H context',
      description: 'Get knowledge graph overview: stats, hub nodes, recent activity, and available skills. Use this for orientation only, not as the default retrieval path for substantive requests.',
      inputSchema: {}
    },
    async () => {
      const context = nodeService.getContext();
      const skills = skillService.listSkills();
      context.skills = skills.map(s => ({ name: s.name, description: s.description, immutable: s.immutable }));

      // First-run welcome message
      if (context.stats.nodeCount === 0) {
        return {
          content: [{ type: 'text', text: 'Empty knowledge graph. This is a fresh start. Ask what matters right now and help create the first useful node.' }],
          structuredContent: {
            ...context,
            welcome: true,
            suggestion: 'Ask what matters right now and create the first useful node.'
          }
        };
      }

      const summary = `Graph: ${context.stats.nodeCount} nodes, ${context.stats.edgeCount} edges, ${context.hubNodes.length} hub nodes, ${skills.length} skills.`;
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: context
      };
    }
  );

  // ========== NODE TOOLS ==========

  registerToolWithAliases(
    'retrieveQueryContext',
    {
      title: 'Retrieve RA-H query context',
      description: 'Given the raw user query plus optional focused node state, retrieve the most relevant graph context for the current turn. It starts with direct graph search and broadens only if useful. Use this when graph context could help answer or complete a broader task. For explicit node lookup, use queryNodes.',
      inputSchema: retrieveQueryContextInputSchema
    },
    async ({ query: rawQuery, focused_node_id, limit = 6 }) => {
      const result = retrievalService.retrieveQueryContext({
        query: rawQuery,
        focused_node_id: focused_node_id ?? null,
        limit,
      });

      const summary = result.shouldRetrieve
        ? `Retrieved ${result.nodes.length} node(s) and ${result.chunks.length} chunk(s) for this turn.`
        : result.reason;

      return {
        content: [{ type: 'text', text: result.shouldRetrieve ? withVisibleJson(summary, result) : summary }],
        structuredContent: result
      };
    }
  );

  registerToolWithAliases(
    'createNode',
    {
      title: 'Add RA-H node',
      description: 'Create a new node. Always search first (queryNodes) to avoid duplicates. If the user explicitly asked to save or import something and the target artifact is clear, write after duplicate/update checks. If you are only suggesting a save, propose the node first and wait for confirmation. Title: max 160 chars, clear and descriptive. Description is strongly recommended and should explicitly describe what the thing is and any surrounding context available, but the write will never be blocked over description quality. Use "link" ONLY for external content (URL, video, article) — omit for synthesis/ideas derived from existing nodes. "source" = verbatim or canonical content stored on the node. The RA-H app owns chunking and embedding from source. Legacy "content" and "chunk" are mapped to source for compatibility.',
      inputSchema: addNodeInputSchema
    },
    async ({ title, content, source, link, description, metadata, chunk }) => {
      const sourceText = source?.trim() || content?.trim() || chunk?.trim();
      const normalizedDescription = typeof description === 'string' ? description.trim() : description;

      const node = nodeService.createNode({
        title: title.trim(),
        source: sourceText,
        link: link?.trim(),
        description: normalizedDescription,
        metadata: metadata || {}
      });

      const summary = `Created node #${node.id}: ${node.title}`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          nodeId: node.id,
          title: node.title,
          message: summary
        }
      };
    }
  );

  registerToolWithAliases(
    'queryNodes',
    {
      title: 'Search RA-H nodes',
      description: 'Search nodes by keyword across title, description, and source fields using the same safe direct-lookup behavior as the app. Use this for direct node lookup or duplicate checks. For full current-turn grounding of a substantive query, prefer retrieveQueryContext. NOT for searching source documents (transcripts, articles) — use searchContentEmbeddings for that.',
      inputSchema: searchNodesInputSchema
    },
    async ({ query: searchQuery, limit = 10, created_after, created_before, event_after, event_before }) => {
      const safeLimit = Math.min(Math.max(limit, 1), 50);
      const result = directNodeLookup({
        search: searchQuery.trim(),
        limit: safeLimit,
        createdAfter: created_after,
        createdBefore: created_before,
        eventAfter: event_after,
        eventBefore: event_before,
      });

      const mappedNodes = result.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        source: node.source ?? null,
        description: node.description ?? null,
        link: node.link ?? null,
        created_at: node.created_at,
        updated_at: node.updated_at,
        event_date: node.event_date ?? null,
      }));
      const payload = {
        count: result.count,
        filters_applied: result.filtersApplied,
        nodes: mappedNodes
      };
      const summary = result.count === 0
        ? 'No nodes found matching that query.'
        : `Found ${result.count} node(s).`;

      return {
        content: [{ type: 'text', text: result.count === 0 ? summary : withVisibleJson(summary, payload) }],
        structuredContent: payload
      };
    }
  );

  registerToolWithAliases(
    'getNodesById',
    {
      title: 'Get RA-H nodes by ID',
      description: 'Load full node records by their IDs (max 10 per call). Chunks over 10K chars are truncated — check chunk_truncated and chunk_length fields. For full text, use searchContentEmbeddings to search or sqliteQuery with substr() to read sections.',
      inputSchema: getNodesInputSchema
    },
    async ({ nodeIds }) => {
      const uniqueIds = [...new Set(nodeIds.filter(id => Number.isFinite(id) && id > 0))];
      if (uniqueIds.length === 0) {
        throw new Error('No valid node IDs provided.');
      }

      const CHUNK_LIMIT = 10000;
      const nodes = [];
      for (const id of uniqueIds) {
        const node = nodeService.getNodeById(id);
        if (node) {
          const rawSource = node.source ?? null;
          const sourceTruncated = rawSource ? rawSource.length > CHUNK_LIMIT : false;

          nodes.push({
            id: node.id,
            title: node.title,
            source: node.source ?? null,
            description: node.description ?? null,
            link: node.link ?? null,
            chunk: sourceTruncated ? rawSource.substring(0, CHUNK_LIMIT) : rawSource,
            chunk_truncated: sourceTruncated,
            chunk_length: rawSource ? rawSource.length : 0,
            metadata: node.metadata ?? null,
            created_at: node.created_at,
            updated_at: node.updated_at,
            event_date: node.event_date ?? null
          });
        }
      }

      return {
        content: [{ type: 'text', text: `Loaded ${nodes.length} of ${uniqueIds.length} nodes.` }],
        structuredContent: {
          count: nodes.length,
          nodes
        }
      };
    }
  );

  registerToolWithAliases(
    'updateNode',
    {
      title: 'Update RA-H node',
      description: 'Update an existing node when it is clearly the same artifact and a net-new node would be redundant. Explicit user-directed updates can proceed once the target node is clear. Description updates should explicitly state what this thing is and any surrounding context available, but the write will never be blocked over description quality. Source content lives in "source". The RA-H app owns chunking and embedding from source. Legacy "content" is mapped to source for compatibility. Title, description, and link are overwritten. Call getNodesById first to verify current state before updating.',
      inputSchema: updateNodeInputSchema
    },
    async ({ id, updates }) => {
      if (!updates || Object.keys(updates).length === 0) {
        throw new Error('At least one field must be provided in updates.');
      }

      // Backward compatibility: map legacy content/chunk → source
      const mappedUpdates = { ...updates };
      if (mappedUpdates.chunk !== undefined && mappedUpdates.source === undefined) {
        mappedUpdates.source = mappedUpdates.chunk;
      }
      if (mappedUpdates.content !== undefined) {
        mappedUpdates.source = mappedUpdates.content;
        delete mappedUpdates.content;
      }
      delete mappedUpdates.chunk;

      if (Object.prototype.hasOwnProperty.call(mappedUpdates, 'description')) {
        mappedUpdates.description = typeof mappedUpdates.description === 'string'
          ? mappedUpdates.description.trim()
          : mappedUpdates.description;
      }

      const node = nodeService.updateNode(id, mappedUpdates);
      const message = `Updated node #${id}`;

      return {
        content: [{ type: 'text', text: message }],
        structuredContent: {
          success: true,
          nodeId: node.id,
          message
        }
      };
    }
  );

  // ========== EDGE TOOLS ==========

  registerToolWithAliases(
    'createEdge',
    {
      title: 'Create RA-H edge',
      description: 'Connect two nodes with an edge only after the user has explicitly confirmed the proposed relationship. Edges are the most valuable part of the graph — they represent understanding, not proximity. Direction matters: reads as sourceId → [explanation] → targetId. The explanation should read as a sentence (e.g. "invented this technique", "contradicts the claim in"). Call queryEdge first to check if a connection already exists between the two nodes.',
      inputSchema: createEdgeInputSchema
    },
    async ({ sourceId, targetId, explanation, confirmed_by_user }) => {
      if (!confirmed_by_user) {
        throw new Error('createEdge requires explicit user confirmation before writing the relationship.');
      }

      const edge = edgeService.createEdge({
        from_node_id: sourceId,
        to_node_id: targetId,
        explanation: explanation.trim(),
        source: 'mcp'
      });

      return {
        content: [{ type: 'text', text: `Created edge from #${sourceId} to #${targetId}` }],
        structuredContent: {
          success: true,
          edgeId: edge.id,
          message: `Created edge from #${sourceId} to #${targetId}`
        }
      };
    }
  );

  registerToolWithAliases(
    'updateEdge',
    {
      title: 'Update RA-H edge',
      description: 'Update an edge explanation only after the user explicitly confirmed the corrected relationship.',
      inputSchema: updateEdgeInputSchema
    },
    async ({ id, explanation, confirmed_by_user }) => {
      if (!confirmed_by_user) {
        throw new Error('updateEdge requires explicit user confirmation before writing the corrected relationship.');
      }

      const edge = edgeService.updateEdge(id, { explanation: explanation.trim() });

      return {
        content: [{ type: 'text', text: `Updated edge #${id}` }],
        structuredContent: {
          success: true,
          edgeId: edge.id,
          message: `Updated edge #${id}`
        }
      };
    }
  );

  registerToolWithAliases(
    'queryEdge',
    {
      title: 'Query RA-H edges',
      description: 'Find edges/connections. Optionally filter by nodeId to see all connections for a specific node. Returns up to 50 edges (default 25) with edge IDs, connected node IDs, and explanations. Use when exploring how nodes relate, checking for existing connections before creating edges, or traversing the graph from a hub node.',
      inputSchema: queryEdgesInputSchema
    },
    async ({ nodeId, limit = 25 }) => {
      const edges = edgeService.getEdges({
        nodeId,
        limit: Math.min(Math.max(limit, 1), 50)
      });

      return {
        content: [{ type: 'text', text: `Found ${edges.length} edge(s).` }],
        structuredContent: {
          count: edges.length,
          edges: edges.map(e => ({
            id: e.id,
            from_node_id: e.from_node_id,
            to_node_id: e.to_node_id,
            type: e.context?.type ?? null,
            explanation: e.explanation ?? e.context?.explanation ?? null
          }))
        }
      };
    }
  );

  // ========== SKILL TOOLS ==========

  registerToolWithAliases(
    'listSkills',
    {
      title: 'List RA-H skills',
      description: 'List the shared skills available to internal and external RA-H agents. Use this to see the current operating doctrine before reading or editing a specific skill.',
      inputSchema: {}
    },
    async () => {
      const skills = skillService.listSkills();

      return {
        content: [{ type: 'text', text: `Found ${skills.length} skill(s).` }],
        structuredContent: {
          count: skills.length,
          skills
        }
      };
    }
  );

  registerToolWithAliases(
    'readSkill',
    {
      title: 'Read RA-H skill',
      description: 'Read one shared RA-H skill by name. Use this before executing a non-trivial workflow that matches the skill trigger.',
      inputSchema: readSkillInputSchema
    },
    async ({ name }) => {
      const skill = skillService.readSkill(name);

      if (!skill) {
        throw new Error(`Skill "${name}" not found. Call listSkills to see available skills.`);
      }

      return {
        content: [{ type: 'text', text: skill.content }],
        structuredContent: skill
      };
    }
  );

  registerToolWithAliases(
    'writeSkill',
    {
      title: 'Write RA-H skill',
      description: 'Create or update a shared RA-H skill when the user explicitly wants to change the doctrine surface. Content should be the full markdown body for that skill.',
      inputSchema: writeSkillInputSchema
    },
    async ({ name, content }) => {
      const result = skillService.writeSkill(name, content);

      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        content: [{ type: 'text', text: `Skill "${name}" saved.` }],
        structuredContent: {
          success: true,
          name,
          message: `Skill "${name}" saved.`
        }
      };
    }
  );

  registerToolWithAliases(
    'deleteSkill',
    {
      title: 'Delete RA-H skill',
      description: 'Delete a shared RA-H skill when the user explicitly wants it removed from the shared skill set.',
      inputSchema: deleteSkillInputSchema
    },
    async ({ name }) => {
      const result = skillService.deleteSkill(name);

      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        content: [{ type: 'text', text: `Skill "${name}" deleted.` }],
        structuredContent: {
          success: true,
          name,
          message: `Skill "${name}" deleted.`
        }
      };
    }
  );

  // ========== CONTENT SEARCH TOOL ==========

  registerToolWithAliases(
    'searchContentEmbeddings',
    {
      title: 'Search RA-H source content',
      description: 'Search through source content (transcripts, books, articles) stored as chunks. Use when you need to find specific text within a node\'s full source material. This only works after the RA-H app has chunked the node source. For node-level search (titles, descriptions), use queryNodes instead.',
      inputSchema: searchContentInputSchema
    },
    async ({ query: searchQuery, node_id, limit = 5 }) => {
      const db = getDb();

      // Check if chunks table exists
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'").get();
      if (!tableCheck) {
        return {
          content: [{ type: 'text', text: 'No chunks table found. Source content has not been chunked yet. Use getNodesById to read the raw source text instead.' }],
          structuredContent: { count: 0, chunks: [], note: 'chunks table does not exist' }
        };
      }

      const safeLimit = Math.min(Math.max(limit, 1), 20);
      const trimmedQuery = searchQuery.trim();
      const fts = checkFtsAvailability();

      let results = null;

      // Try FTS5 first (handles multi-word, relevance ranked)
      if (fts.chunks) {
        const ftsQuery = sanitizeFtsQuery(trimmedQuery);
        if (ftsQuery) {
          try {
            let sql, params;

            if (node_id) {
              sql = `
                SELECT c.id, c.node_id, c.chunk_idx, c.text, n.title as node_title
                FROM chunks c
                JOIN nodes n ON c.node_id = n.id
                WHERE c.node_id = ?
                AND c.id IN (SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?)
                ORDER BY c.chunk_idx ASC
                LIMIT ?
              `;
              params = [node_id, ftsQuery, safeLimit];
            } else {
              sql = `
                WITH fts_matches AS (
                  SELECT rowid, rank FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?
                )
                SELECT c.id, c.node_id, c.chunk_idx, c.text, n.title as node_title
                FROM fts_matches fm
                JOIN chunks c ON c.id = fm.rowid
                JOIN nodes n ON c.node_id = n.id
                ORDER BY fm.rank
              `;
              params = [ftsQuery, safeLimit];
            }

            results = query(sql, params);
          } catch (err) {
            log('FTS content search failed, falling back to LIKE:', err.message);
            results = null;
          }
        }
      }

      // Fallback: LIKE with word splitting
      if (results === null) {
        const words = trimmedQuery.split(/\s+/).filter(w => w.length > 0);

        let sql = `
          SELECT c.id, c.node_id, c.chunk_idx, c.text, n.title as node_title
          FROM chunks c
          JOIN nodes n ON c.node_id = n.id
          WHERE 1=1
        `;
        const params = [];

        if (node_id) {
          sql += ` AND c.node_id = ?`;
          params.push(node_id);
        }

        for (const word of words) {
          sql += ` AND c.text LIKE ? COLLATE NOCASE`;
          params.push(`%${word}%`);
        }

        sql += ` ORDER BY n.updated_at DESC, c.chunk_idx ASC LIMIT ?`;
        params.push(safeLimit);

        results = query(sql, params);
      }

      const summary = results.length === 0
        ? 'No matching content found in chunks.'
        : `Found ${results.length} chunk(s) matching "${trimmedQuery}".`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          count: results.length,
          chunks: results.map(r => ({
            id: r.id,
            node_id: r.node_id,
            chunk_idx: r.chunk_idx,
            text: r.text,
            node_title: r.node_title
          }))
        }
      };
    }
  );

  // ========== SQL QUERY TOOL ==========

  registerToolWithAliases(
    'sqliteQuery',
    {
      title: 'Execute read-only SQL',
      description: 'Execute read-only SQL queries against the knowledge graph database. Tables include nodes, edges, chunks, and migration snapshots. Use PRAGMA table_info(tablename) for schema. Only SELECT/WITH/PRAGMA allowed. Use when structured tools are insufficient — e.g., complex JOINs, aggregations, or custom filtering. Read readSkill("schema") for table definitions and query patterns.',
      inputSchema: sqliteQueryInputSchema
    },
    async ({ sql: userSql, format = 'json' }) => {
      if (!isReadOnlyQuery(userSql)) {
        throw new Error('Only SELECT, WITH, and PRAGMA statements are allowed. Write operations must use dedicated tools.');
      }

      try {
        const rows = query(userSql);
        const rowCount = Array.isArray(rows) ? rows.length : 0;

        if (format === 'table' && Array.isArray(rows) && rows.length > 0) {
          // Simple table format
          const cols = Object.keys(rows[0]);
          const header = cols.join(' | ');
          const separator = cols.map(c => '-'.repeat(c.length)).join(' | ');
          const body = rows.map(r => cols.map(c => String(r[c] ?? '')).join(' | ')).join('\n');
          const tableStr = `${header}\n${separator}\n${body}`;

          return {
            content: [{ type: 'text', text: `${rowCount} row(s).\n\n${tableStr}` }],
            structuredContent: { count: rowCount, rows }
          };
        }

        return {
          content: [{ type: 'text', text: `${rowCount} row(s).` }],
          structuredContent: { count: rowCount, rows: Array.isArray(rows) ? rows : [rows] }
        };
      } catch (err) {
        throw new Error(`SQL error: ${err.message}`);
      }
    }
  );

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server ready');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('Shutting down...');
    closeDatabase();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('Shutting down...');
    closeDatabase();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[ra-h-standalone] Fatal error:', error);
  process.exit(1);
});
