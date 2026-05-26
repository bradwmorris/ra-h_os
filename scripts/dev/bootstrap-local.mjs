#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const repoDir = process.cwd();
const envTemplate = path.join(repoDir, '.env.example');
const targetEnv = path.join(repoDir, '.env.local');
const supportedProfiles = new Set(['openai', 'qwen-local', 'llama-cpp']);

function log(message) {
  console.log(`[bootstrap-local] ${message}`);
}

function getDefaultDbPath() {
  const homeDir = os.homedir();

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'RA-H', 'db', 'rah.sqlite');
  }

  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'RA-H', 'db', 'rah.sqlite');
  }

  return path.join(
    process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'),
    'RA-H',
    'db',
    'rah.sqlite'
  );
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) return acc;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function expandPath(rawPath) {
  let value = rawPath;

  if (value.startsWith('~')) {
    value = path.join(os.homedir(), value.slice(1));
  }

  value = value.replace(/\$HOME/g, os.homedir());
  value = value.replace(/%APPDATA%/g, process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'));

  return path.resolve(value);
}

function ensureEnvFile() {
  if (!fs.existsSync(envTemplate)) {
    throw new Error(`Missing ${envTemplate}`);
  }

  if (fs.existsSync(targetEnv)) {
    log('.env.local already exists; leaving it untouched.');
    return;
  }

  fs.copyFileSync(envTemplate, targetEnv);
  log('Created .env.local from .env.example');
}

function ensureEnvValue(key, value) {
  if (!value) return;

  const lines = fs.existsSync(targetEnv)
    ? fs.readFileSync(targetEnv, 'utf8').split(/\r?\n/)
    : [];
  let found = false;

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      if (found) return line;
      found = true;
      return `${key}=${value}`;
    }
    if (trimmed.startsWith(`# ${key}=`) || trimmed.startsWith(`#${key}=`)) {
      if (found) return line;
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    nextLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(targetEnv, `${nextLines.join('\n').replace(/\n+$/, '')}\n`);
  log(`Set ${key} in .env.local`);
}

function parseArgs(argv) {
  const args = { profile: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      args.profile = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--profile=')) {
      args.profile = arg.slice('--profile='.length);
    }
  }
  return args;
}

function normalizeSetupProfile(rawProfile) {
  if (!rawProfile) return undefined;
  if (rawProfile === 'qwen' || rawProfile === 'local' || rawProfile === 'ollama') {
    return 'qwen-local';
  }
  if (rawProfile === 'llama' || rawProfile === 'llamacpp' || rawProfile === 'cpp') {
    return 'llama-cpp';
  }
  return rawProfile;
}

function applySetupProfile(profile) {
  if (!profile) return;
  if (!supportedProfiles.has(profile)) {
    throw new Error(`Unsupported setup profile "${profile}". Use "openai", "qwen-local", or "llama-cpp".`);
  }

  if (profile === 'openai') {
    ensureEnvValue('LLM_PROFILE', 'openai');
    ensureEnvValue('EMBEDDING_PROFILE', 'openai');
    ensureEnvValue('EMBEDDING_MODEL', 'text-embedding-3-small');
    ensureEnvValue('EMBEDDING_DIMENSIONS', '1536');
    ensureEnvValue('VECTOR_BACKEND', 'sqlite-vec');
    return;
  }

  if (profile === 'qwen-local') {
    ensureEnvValue('LLM_PROFILE', 'openai-compatible');
    ensureEnvValue('LLM_BASE_URL', process.env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1');
    ensureEnvValue('LLM_MODEL', 'qwen3:4b');
    ensureEnvValue('EMBEDDING_PROFILE', 'openai-compatible');
    ensureEnvValue('EMBEDDING_BASE_URL', process.env.EMBEDDING_BASE_URL || 'http://127.0.0.1:11434/v1');
    ensureEnvValue('EMBEDDING_MODEL', 'qwen3-embedding:0.6b');
    ensureEnvValue('EMBEDDING_DIMENSIONS', '1024');
    ensureEnvValue('VECTOR_BACKEND', 'sqlite-vec');
    return;
  }

  ensureEnvValue('LLM_PROFILE', 'openai-compatible');
  ensureEnvValue('LLM_BASE_URL', process.env.LLM_BASE_URL || 'http://127.0.0.1:8080/v1');
  ensureEnvValue('LLM_MODEL', 'qwen3-4b');
  ensureEnvValue('EMBEDDING_PROFILE', 'openai-compatible');
  ensureEnvValue('EMBEDDING_BASE_URL', process.env.EMBEDDING_BASE_URL || 'http://127.0.0.1:8081/v1');
  ensureEnvValue('EMBEDDING_MODEL', 'qwen3-embedding-0.6b');
  ensureEnvValue('EMBEDDING_DIMENSIONS', '1024');
  ensureEnvValue('VECTOR_BACKEND', 'sqlite-vec');
}

function assertEmbeddingProfileSelected(env) {
  if (env.EMBEDDING_PROFILE) {
    return;
  }

  throw new Error([
    'Choose an embedding profile before database setup.',
    '',
    'The selected embedding model controls sqlite-vec table dimensions:',
    '  OpenAI text-embedding-3-small -> 1536',
    '  Local Qwen qwen3-embedding:0.6b -> 1024',
    '',
    'Run one of:',
    '  npm run setup:local -- --profile openai',
    '  npm run setup:local -- --profile qwen-local',
    '  npm run setup:local -- --profile llama-cpp',
    '',
    'If you change embedding provider later, run:',
    '  npm run rebuild:embeddings',
  ].join('\n'));
}

function ensureCoreSchema(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'executor',
      system_prompt TEXT NOT NULL,
      available_tools TEXT NOT NULL,
      model TEXT NOT NULL,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      memory TEXT,
      prompts TEXT
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY,
      title TEXT,
      description TEXT,
      source TEXT,
      link TEXT,
      event_date TEXT,
      created_at TEXT,
      updated_at TEXT,
      metadata TEXT,
      embedding BLOB,
      embedding_updated_at TEXT,
      embedding_text TEXT,
      chunk_status TEXT DEFAULT 'not_chunked'
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      node_id INTEGER NOT NULL,
      chunk_idx INTEGER,
      text TEXT,
      created_at TEXT,
      embedding_type TEXT DEFAULT 'text-embedding-3-small',
      metadata TEXT,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_by_node ON chunks(node_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_by_node_idx ON chunks(node_id, chunk_idx);

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY,
      from_node_id INTEGER NOT NULL,
      to_node_id INTEGER NOT NULL,
      source TEXT,
      created_at TEXT,
      context TEXT,
      explanation TEXT,
      FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY,
      chat_type TEXT,
      helper_name TEXT,
      agent_type TEXT DEFAULT 'orchestrator',
      delegation_id INTEGER,
      user_message TEXT,
      assistant_message TEXT,
      thread_id TEXT,
      focused_node_id INTEGER,
      created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
      metadata TEXT,
      FOREIGN KEY (focused_node_id) REFERENCES nodes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      table_name TEXT NOT NULL,
      action TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      summary TEXT,
      enriched_summary TEXT,
      snapshot_json TEXT
    );

    CREATE TABLE IF NOT EXISTS voice_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER,
      session_id TEXT,
      helper_name TEXT,
      request_id TEXT,
      message_id TEXT,
      voice TEXT,
      model TEXT,
      chars INTEGER,
      cost_usd REAL,
      duration_ms INTEGER,
      text_preview TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voice_usage_session ON voice_usage(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_voice_usage_chat ON voice_usage(chat_id);
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
      title,
      source,
      description,
      content='nodes',
      content_rowid='id'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='id'
    );
  `);

  const now = new Date().toISOString();

  const agentCount = Number(db.prepare('SELECT COUNT(*) as count FROM agents').get().count || 0);
  if (agentCount === 0) {
    db.prepare(`
      INSERT INTO agents (
        key, display_name, role, system_prompt, available_tools, model, description, enabled, created_at, updated_at, prompts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      'ra-h',
      'ra-h',
      'orchestrator',
      "You are ra-h, the main orchestrator for RA-H. Coordinate work, delegate to mini ra-hs when tasks can be isolated, and keep the conversation focused on the user's goals.",
      '["queryNodes","createNode","updateNode","createEdge","queryEdge","updateEdge","searchContentEmbeddings","webSearch","think","delegateToMiniRAH"]',
      'anthropic/claude-sonnet-4.5',
      'Opinionated orchestrator agent',
      now,
      now,
      '[{"id":"p_seed_0","name":"Summary of Focus","content":"Summarize the primary focused node clearly. Include 3–5 key points and cite [NODE:id:\\"title\\"]."},{"id":"p_seed_1","name":"Next Steps","content":"Propose 3 concrete next actions based on the focused nodes with references to [NODE:id:\\"title\\"]."}]'
    );
  }

  const edgeCols = db.prepare('PRAGMA table_info(edges)').all().map(col => col.name);
  const hasEdgeCol = (name) => edgeCols.includes(name);
  const needsLegacyEdgeRewrite =
    !hasEdgeCol('from_node_id') ||
    !hasEdgeCol('to_node_id') ||
    !hasEdgeCol('source') ||
    !hasEdgeCol('created_at') ||
    !hasEdgeCol('context') ||
    hasEdgeCol('from_id') ||
    hasEdgeCol('to_id') ||
    hasEdgeCol('description') ||
    hasEdgeCol('updated_at');

  if (needsLegacyEdgeRewrite) {
    const fromExpr = hasEdgeCol('from_node_id')
      ? 'from_node_id'
      : hasEdgeCol('from_id')
        ? 'from_id'
        : 'NULL';
    const toExpr = hasEdgeCol('to_node_id')
      ? 'to_node_id'
      : hasEdgeCol('to_id')
        ? 'to_id'
        : 'NULL';
    const sourceExpr = hasEdgeCol('source') ? 'source' : "'legacy'";
    const createdAtExpr = hasEdgeCol('created_at') ? 'created_at' : 'CURRENT_TIMESTAMP';
    const contextExpr = hasEdgeCol('context') ? 'context' : 'NULL';
    const explanationExpr = hasEdgeCol('explanation')
      ? 'explanation'
      : hasEdgeCol('description')
        ? 'description'
        : hasEdgeCol('context')
          ? "CASE WHEN json_valid(context) THEN json_extract(context, '$.explanation') ELSE NULL END"
          : 'NULL';

    console.log('Migrating legacy edges table to canonical schema');
    db.exec('PRAGMA foreign_keys=OFF;');
    db.exec(`
      BEGIN TRANSACTION;
      DROP INDEX IF EXISTS idx_edges_from;
      DROP INDEX IF EXISTS idx_edges_to;
      ALTER TABLE edges RENAME TO edges_legacy_migration;
      CREATE TABLE edges (
        id INTEGER PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        source TEXT,
        created_at TEXT,
        context TEXT,
        explanation TEXT,
        FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );
      INSERT INTO edges (id, from_node_id, to_node_id, source, created_at, context, explanation)
      SELECT
        id,
        ${fromExpr},
        ${toExpr},
        ${sourceExpr},
        COALESCE(${createdAtExpr}, CURRENT_TIMESTAMP),
        ${contextExpr},
        ${explanationExpr}
      FROM edges_legacy_migration
      WHERE ${fromExpr} IS NOT NULL
        AND ${toExpr} IS NOT NULL;
      DROP TABLE edges_legacy_migration;
      COMMIT;
    `);
    db.exec('PRAGMA foreign_keys=ON;');
  }

  const refreshedEdgeCols = db.prepare('PRAGMA table_info(edges)').all().map(col => col.name);
  if (!refreshedEdgeCols.includes('explanation')) {
    db.exec('ALTER TABLE edges ADD COLUMN explanation TEXT;');
    db.exec(`
      UPDATE edges
      SET explanation = CASE
        WHEN json_valid(context) THEN json_extract(context, '$.explanation')
        ELSE explanation
      END
      WHERE explanation IS NULL
        AND context IS NOT NULL;
    `);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id);
  `);

  const chatCols = db.prepare('PRAGMA table_info(chats)').all().map(col => col.name);
  const hasChatCol = (name) => chatCols.includes(name);
  const needsLegacyChatRewrite =
    hasChatCol('focused_memory_id') ||
    ['chat_type', 'helper_name', 'agent_type', 'delegation_id', 'user_message', 'assistant_message', 'thread_id', 'focused_node_id', 'created_at', 'metadata']
      .some((name) => !hasChatCol(name));

  if (needsLegacyChatRewrite) {
    const chatTypeExpr = hasChatCol('chat_type') ? 'chat_type' : 'NULL';
    const helperNameExpr = hasChatCol('helper_name')
      ? 'helper_name'
      : hasChatCol('title')
        ? 'title'
        : 'NULL';
    const agentTypeExpr = hasChatCol('agent_type')
      ? "COALESCE(agent_type, 'orchestrator')"
      : "'orchestrator'";
    const delegationIdExpr = hasChatCol('delegation_id') ? 'delegation_id' : 'NULL';
    const userMessageExpr = hasChatCol('user_message') ? 'user_message' : 'NULL';
    const assistantMessageExpr = hasChatCol('assistant_message') ? 'assistant_message' : 'NULL';
    const threadIdExpr = hasChatCol('thread_id') ? 'thread_id' : 'NULL';
    const focusedNodeIdExpr = hasChatCol('focused_node_id') ? 'focused_node_id' : 'NULL';
    const createdAtChatExpr = hasChatCol('created_at') ? 'created_at' : 'CURRENT_TIMESTAMP';
    const metadataChatExpr = hasChatCol('metadata') ? 'metadata' : 'NULL';

    console.log('Migrating legacy chats table to canonical schema');
    db.exec('PRAGMA foreign_keys=OFF;');
    db.exec(`
      BEGIN TRANSACTION;
      DROP INDEX IF EXISTS idx_chats_thread;
      ALTER TABLE chats RENAME TO chats_legacy_cleanup;
      CREATE TABLE chats (
        id INTEGER PRIMARY KEY,
        chat_type TEXT,
        helper_name TEXT,
        agent_type TEXT DEFAULT 'orchestrator',
        delegation_id INTEGER,
        user_message TEXT,
        assistant_message TEXT,
        thread_id TEXT,
        focused_node_id INTEGER,
        created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
        metadata TEXT,
        FOREIGN KEY (focused_node_id) REFERENCES nodes(id) ON DELETE SET NULL
      );
      INSERT INTO chats (
        id, chat_type, helper_name, agent_type, delegation_id,
        user_message, assistant_message, thread_id, focused_node_id,
        created_at, metadata
      )
      SELECT
        id,
        ${chatTypeExpr},
        ${helperNameExpr},
        ${agentTypeExpr},
        ${delegationIdExpr},
        ${userMessageExpr},
        ${assistantMessageExpr},
        ${threadIdExpr},
        ${focusedNodeIdExpr},
        COALESCE(${createdAtChatExpr}, CURRENT_TIMESTAMP),
        ${metadataChatExpr}
      FROM chats_legacy_cleanup;
      DROP TABLE chats_legacy_cleanup;
      COMMIT;
    `);
    db.exec('PRAGMA foreign_keys=ON;');
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_chats_thread ON chats(thread_id);");

  const nodeCols = db.prepare('PRAGMA table_info(nodes)').all().map(col => col.name);
  const hasNodeCol = (name) => nodeCols.includes(name);

  if (!hasNodeCol('description')) {
    db.exec('ALTER TABLE nodes ADD COLUMN description TEXT;');
  }
  if (!hasNodeCol('metadata')) {
    db.exec('ALTER TABLE nodes ADD COLUMN metadata TEXT;');
  }
  if (!hasNodeCol('source')) {
    db.exec('ALTER TABLE nodes ADD COLUMN source TEXT;');
  }
  if (!hasNodeCol('event_date')) {
    db.exec('ALTER TABLE nodes ADD COLUMN event_date TEXT;');
  }
  if (!hasNodeCol('chunk_status')) {
    db.exec("ALTER TABLE nodes ADD COLUMN chunk_status TEXT DEFAULT 'not_chunked';");
  }

  if (hasNodeCol('content')) {
    db.exec(`
      UPDATE nodes
      SET source = content,
          chunk_status = 'not_chunked'
      WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
        AND content IS NOT NULL
        AND LENGTH(TRIM(content)) > 0;
    `);
  }
  if (hasNodeCol('notes')) {
    db.exec(`
      UPDATE nodes
      SET source = notes,
          chunk_status = 'not_chunked'
      WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
        AND notes IS NOT NULL
        AND LENGTH(TRIM(notes)) > 0;
    `);
  }
  if (hasNodeCol('chunk')) {
    db.exec(`
      UPDATE nodes
      SET source = chunk,
          chunk_status = 'not_chunked'
      WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
        AND chunk IS NOT NULL
        AND LENGTH(TRIM(chunk)) > 0;
    `);
    }

  db.exec(`
    UPDATE nodes
    SET source = title || CASE
      WHEN description IS NOT NULL AND LENGTH(TRIM(description)) > 0
        THEN char(10) || char(10) || description
      ELSE ''
    END,
    chunk_status = 'not_chunked'
    WHERE source IS NULL OR LENGTH(TRIM(source)) = 0;
  `);

  db.exec(`
    UPDATE nodes
    SET chunk_status = 'not_chunked'
    WHERE source IS NOT NULL
      AND LENGTH(TRIM(source)) > 0
      AND (chunk_status IS NULL OR chunk_status != 'chunked');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dimension_migration_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      dimension_count INTEGER NOT NULL,
      assignment_count INTEGER NOT NULL,
      payload TEXT
    );
  `);

  const hasLegacyDimensions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dimensions'").get();
  const hasLegacyNodeDimensions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='node_dimensions'").get();
  if (hasLegacyDimensions || hasLegacyNodeDimensions) {
    const existingSnapshotCount = Number(db.prepare('SELECT COUNT(*) as count FROM dimension_migration_snapshots').get().count || 0);
    if (existingSnapshotCount === 0) {
      const dimensionCount = hasLegacyDimensions
        ? Number(db.prepare('SELECT COUNT(*) as count FROM dimensions').get().count || 0)
        : 0;
      const assignmentCount = hasLegacyNodeDimensions
        ? Number(db.prepare('SELECT COUNT(*) as count FROM node_dimensions').get().count || 0)
        : 0;
      const payload = hasLegacyNodeDimensions
        ? (db.prepare(`
            SELECT COALESCE(
              json_group_array(
                json_object(
                  'node_id', nd.node_id,
                  'dimension', nd.dimension,
                  'description', d.description,
                  'icon', d.icon,
                  'is_priority', d.is_priority
                )
              ),
              '[]'
            ) AS payload
            FROM node_dimensions nd
            LEFT JOIN dimensions d ON d.name = nd.dimension
          `).get().payload || '[]')
        : '[]';

      db.prepare(`
        INSERT INTO dimension_migration_snapshots (dimension_count, assignment_count, payload)
        VALUES (?, ?, ?)
      `).run(dimensionCount, assignmentCount, payload);
    }

    db.exec(`
      DROP INDEX IF EXISTS idx_dim_by_dimension;
      DROP INDEX IF EXISTS idx_dim_by_node;
      DROP TABLE IF EXISTS node_dimensions;
      DROP TABLE IF EXISTS dimensions;
    `);
  }

  db.exec('DROP VIEW IF EXISTS nodes_v;');
  db.exec(`
    CREATE VIEW nodes_v AS
    SELECT n.id,
           n.title,
           n.description,
           n.source,
           n.link,
           n.event_date,
           n.metadata,
           n.created_at,
           n.updated_at
    FROM nodes n;
  `);
}

function getEmbeddingDimensions(env) {
  const defaultDimensions = env.EMBEDDING_PROFILE === 'openai-compatible' || env.EMBEDDING_PROFILE === 'custom'
    ? '1024'
    : '1536';
  return Number(env.EMBEDDING_DIMENSIONS || defaultDimensions);
}

function tryInitVectorTables(db, dbPath, env) {
  const extension = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so';
  const extensionPath = process.env.SQLITE_VEC_EXTENSION_PATH || path.join(repoDir, 'vendor', 'sqlite-extensions', `vec0.${extension}`);
  const dimensions = getEmbeddingDimensions(env);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid EMBEDDING_DIMENSIONS="${env.EMBEDDING_DIMENSIONS}"`);
  }

  try {
    db.loadExtension(extensionPath);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
        node_id INTEGER PRIMARY KEY,
        embedding FLOAT[${dimensions}]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding FLOAT[${dimensions}]
      );
    `);
    log(`Initialized sqlite-vec tables using ${extensionPath}`);
  } catch (error) {
    log(`sqlite-vec unavailable for bootstrap (${dbPath}). Continuing without vector tables.`);
  }
}

function main() {
  const major = Number(process.versions.node.split('.')[0] || '0');
  if (major < 20) {
    throw new Error(`Node.js 20+ required (found ${process.version})`);
  }

  const args = parseArgs(process.argv.slice(2));
  const setupProfile = normalizeSetupProfile(args.profile);

  ensureEnvFile();
  applySetupProfile(setupProfile);

  const env = { ...parseEnvFile(targetEnv), ...process.env };
  assertEmbeddingProfileSelected(env);
  if (process.env.SQLITE_DB_PATH) {
    ensureEnvValue('SQLITE_DB_PATH', process.env.SQLITE_DB_PATH);
    env.SQLITE_DB_PATH = process.env.SQLITE_DB_PATH;
  }
  const dbPath = expandPath(env.SQLITE_DB_PATH || getDefaultDbPath());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.closeSync(fs.openSync(dbPath, 'w'));
  }

  const db = new Database(dbPath);
  try {
    ensureCoreSchema(db);
    tryInitVectorTables(db, dbPath, env);
  } finally {
    db.close();
  }

  log(`Bootstrap complete. Database ready at ${dbPath}`);
  log("Run 'npm run dev' to start the app.");
}

try {
  main();
} catch (error) {
  console.error(`[bootstrap-local] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
