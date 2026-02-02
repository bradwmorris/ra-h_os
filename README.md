# RA-H OS

A local SQLite database with a UI for storing knowledge, and an MCP server so your AI tools can read/write to it.

**Full documentation:** [ra-h.com/docs](https://ra-h.com/docs)

---

## What This Does

1. **Stores knowledge locally** — Notes, bookmarks, ideas, research in a SQLite database on your machine
2. **Provides a UI** — Browse, search, and organize your nodes at `localhost:3000`
3. **Exposes an MCP server** — Claude Code, Cursor, or any MCP client can query and add to your knowledge base

Your data stays on your machine. Nothing is sent anywhere unless you configure an API key.

---

## Requirements

- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **macOS** — Works out of the box
- **Linux/Windows** — Requires building sqlite-vec manually (see below)

---

## Install

```bash
git clone https://github.com/bradwmorris/ra-h_os.git
cd ra-h_os
npm install
npm rebuild better-sqlite3
./scripts/dev/bootstrap-local.sh
npm run dev
```

Open [localhost:3000](http://localhost:3000). Done.

---

## OpenAI API Key

**Optional but recommended.** Without a key, you can still create and organize nodes manually.

With a key, you get:
- Auto-generated descriptions when you add nodes
- Automatic dimension/tag assignment
- Semantic search (find similar content, not just keyword matches)

**Cost:** Less than $0.10/day for heavy use. Most users spend $1-2/month.

**Setup:** The app will prompt you on first launch, or go to Settings → API Keys.

Get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## Where Your Data Lives

```
~/Library/Application Support/RA-H/db/rah.sqlite   # macOS
~/.local/share/RA-H/db/rah.sqlite                  # Linux
%APPDATA%/RA-H/db/rah.sqlite                       # Windows
```

This is a standard SQLite file. You can:
- Back it up by copying the file
- Query it directly with `sqlite3` or any SQLite tool
- Move it between machines

---

## Connect Claude Code (or other MCP clients)

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "ra-h": {
      "command": "npx",
      "args": ["ra-h-mcp-server"]
    }
  }
}
```

Restart Claude Code. Your agent can now use these tools:

| Tool | What it does |
|------|--------------|
| `rah_search_nodes` | Find nodes by keyword |
| `rah_add_node` | Create a new node |
| `rah_get_nodes` | Fetch nodes by ID |
| `rah_update_node` | Edit an existing node |
| `rah_create_edge` | Link two nodes together |
| `rah_query_edges` | Find connections |
| `rah_list_dimensions` | List all tags/categories |

**Example prompts for Claude Code:**
- "Search my knowledge base for notes about React performance"
- "Add a node about the article I just read on transformers"
- "What nodes are connected to my 'project-ideas' dimension?"

---

## Direct Database Access

Query your database directly:

```bash
# Open the database
sqlite3 ~/Library/Application\ Support/RA-H/db/rah.sqlite

# List all nodes
SELECT id, title, created_at FROM nodes ORDER BY created_at DESC LIMIT 10;

# Search by title
SELECT title, description FROM nodes WHERE title LIKE '%react%';

# Find connections
SELECT n1.title, e.explanation, n2.title
FROM edges e
JOIN nodes n1 ON e.from_node_id = n1.id
JOIN nodes n2 ON e.to_node_id = n2.id
LIMIT 10;
```

See [ra-h.com/docs/schema](https://ra-h.com/docs/schema) for full schema documentation.

---

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the app at localhost:3000 |
| `npm run build` | Production build |
| `npm run type-check` | Check TypeScript |

---

## Linux/Windows

The bundled sqlite-vec binary only works on macOS. For other platforms:

1. Build sqlite-vec from [github.com/asg017/sqlite-vec](https://github.com/asg017/sqlite-vec)
2. Place at `vendor/sqlite-extensions/vec0.so` (Linux) or `vec0.dll` (Windows)

Without sqlite-vec, everything works except semantic/vector search.

---

## More

- **Full docs:** [ra-h.com/docs](https://ra-h.com/docs)
- **Issues:** [github.com/bradwmorris/ra-h_os/issues](https://github.com/bradwmorris/ra-h_os/issues)
- **License:** MIT
