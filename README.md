# RA-H OS

```
 ██████╗  █████╗       ██╗  ██╗
 ██╔══██╗██╔══██╗      ██║  ██║
 ██████╔╝███████║█████╗███████║
 ██╔══██╗██╔══██║╚════╝██╔══██║
 ██║  ██║██║  ██║      ██║  ██║
 ╚═╝  ╚═╝╚═╝  ╚═╝      ╚═╝  ╚═╝
```

**TL;DR:** Clone this repository, choose where the models run, then start the local app. Your SQLite database stays on your device in every setup. Choose **OpenAI** if you want the easiest model setup. Choose **local Qwen** through Ollama or llama.cpp if you want the utility model and embedding model running on your own machine.

[![Watch the setup walkthrough](https://img.youtube.com/vi/YyUCGigZIZE/hqdefault.jpg)](https://youtu.be/YyUCGigZIZE?si=USYgvmwtdGpgGdwu)

> **Cross-platform local runtime:** macOS works out of the box. OpenAI is the default AI path. A supported local model profile is available through OpenAI-compatible local endpoints, and Qdrant is available as a vector sidecar when sqlite-vec is unreliable on your platform.

**Docs start here:** [docs/README.md](./docs/README.md)

---

## What This Does

1. **Stores knowledge locally** — Notes, bookmarks, ideas, research in a SQLite database on your machine
2. **Provides a UI** — Browse, search, and organize your nodes at `localhost:3000`
3. **Exposes an MCP server** — Claude Code and other MCP clients can query and add to your knowledge base

Your database stays on your machine. With the `openai` profile, model requests go to OpenAI after you add an API key. With `qwen-local` or `llama-cpp`, model requests go to your local OpenAI-compatible endpoints.

Current contract:
- no runtime `dimensions`
- no separate runtime `contexts` layer or context capsule
- node quality comes from `title`, `description`, `source`, `metadata`, and explicit `edges`
- direct node lookup first for specific-node intent
- `getContext` for orientation and `retrieveQueryContext` for broader current-turn grounding
- standalone MCP writes node data, but the app owns chunking and embeddings: `nodes.source` becomes readable `chunks`, node-level vectors in `vec_nodes`, and passage vectors in `vec_chunks`
- local model support uses external OpenAI-compatible model servers; RA-H does not bundle model weights

---

## Requirements

- **Node.js 20.18.1+** — [nodejs.org](https://nodejs.org/)
- **macOS** — Works out of the box
- **Windows/Linux** — Core app flow is being validated; vector search requires sqlite-vec for your platform or Qdrant as the sidecar backend

---

## Install

### Quick Install (one-liner)

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/bradwmorris/ra-h_os/main/scripts/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/bradwmorris/ra-h_os/main/scripts/install.ps1 | iex
```

> **Security note:** To review before running: `curl -fsSL <url> -o install.sh && less install.sh && bash install.sh`

The scripts clone the repo, install dependencies, run setup, and prompt for your OpenAI API key. Node.js and Ollama (for `qwen-local`) are installed automatically if missing. See `scripts/install.sh` / `scripts/install.ps1` for full source.

**Supported flags:**

| Flag (bash) | Flag (PowerShell) | Default | Description |
|---|---|---|---|
| `--profile` | `-AiProfile` | `openai` | `openai`, `qwen-local`, or `llama-cpp` |
| `--dir` | `-InstallDir` | `ra-h_os` | Clone destination |
| `--llm-port` | `-LlmPort` | `8080` | llama.cpp chat port |
| `--embedding-port` | `-EmbeddingPort` | `8081` | llama.cpp embedding port |
| `--yes` / `-y` | `-Yes` | off | Non-interactive / CI mode |

**CI/CD (GitHub Actions):**
```yaml
- name: Install RA-H
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: curl -fsSL https://raw.githubusercontent.com/bradwmorris/ra-h_os/main/scripts/install.sh | bash -s -- --yes
```

---

### Choose One Model Path

Every path uses a local SQLite database. The choice is only about where the two AI models run:

| You want... | Use this path |
|-------------|---------------|
| The simplest setup and strongest default model quality | **Local DB + OpenAI models** |
| No model calls leaving your computer | **Local DB + local Qwen models** |

What "OpenAI models" means:
- Your database is local.
- Your notes, graph, chunks, and vectors are stored in SQLite on your device.
- RA-H sends utility-model requests and embedding requests to the OpenAI API after you add an API key.
- The utility model helps with descriptions and summaries. The embedding model powers semantic search.
- Choose this if you want the easiest setup and do not want to manage local model runtimes.

What "local Qwen models" means:
- Your database is local.
- The utility model runs locally.
- The embedding model runs locally.
- Those model requests go to Ollama or llama.cpp on your device, not to OpenAI or another hosted model API.
- The utility model helps with descriptions and summaries. The embedding model powers semantic search.
- Choose this if you care most about local control, privacy, offline operation, or avoiding API usage. It requires more setup and enough local hardware.

### Option 1: Local DB + OpenAI Models

Use this if you want RA-H running quickly and are comfortable using OpenAI for descriptions, embeddings, and semantic search.

```bash
git clone https://github.com/bradwmorris/ra-h_os.git
cd ra-h_os
npm install
npm run setup:local -- --profile openai
npm run dev
```

Open [localhost:3000](http://localhost:3000). Add your OpenAI API key when the app prompts you, or later in Settings -> API Keys.

### Option 2A: Local DB + Local Qwen/Ollama

Use this if you want the easiest local-model setup. Ollama runs the local utility and embedding models.

Prerequisites:
- Ollama is installed and running.
- These models are pulled before setup.

```bash
git clone https://github.com/bradwmorris/ra-h_os.git
cd ra-h_os
npm install
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
npm run setup:local -- --profile qwen-local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Settings -> API Keys will show the active local model profile and disable OpenAI key entry.

### Option 2B: Local DB + Local Qwen/llama.cpp

Use this if you want local model calls and prefer managing GGUF files and llama.cpp server processes yourself.

Prerequisites:
- llama.cpp is installed.
- You have compatible Qwen chat and embedding GGUF files.
- You start separate OpenAI-compatible servers before running RA-H setup.

Example llama.cpp servers:

```bash
llama-server -m /models/qwen3-4b.gguf --port 8080
llama-server -m /models/qwen3-embedding-0.6b.gguf --embedding --port 8081
```

Then set up RA-H:

```bash
git clone https://github.com/bradwmorris/ra-h_os.git
cd ra-h_os
npm install
npm run setup:local -- --profile llama-cpp
npm run dev
```

Open [localhost:3000](http://localhost:3000). Settings -> API Keys will show the active local model profile and disable OpenAI key entry.

### Connect MCP After App Setup

MCP lets Claude Code, Codex, Cursor, and other coding agents read and write your RA-H graph. Configure it after the app database exists.

If you used the default database path:

```bash
npx -y ra-h-mcp-server@latest setup --client claude-code,codex --yes
```

If you used a custom `SQLITE_DB_PATH`, pass that exact same path with `--db`:

```bash
npx -y ra-h-mcp-server@latest setup \
  --client claude-code,codex \
  --yes \
  --db "/absolute/path/to/rah.sqlite"
```

Fully restart the agent client after changing MCP config. For Claude Code on Mac, use **Cmd+Q**, then reopen it.

Full install details:
- [docs/README.md](./docs/README.md)
- [docs/8_mcp.md](./docs/8_mcp.md)
- [docs/10_full-local.md](./docs/10_full-local.md)
- [LOCAL-MODELS.md](./LOCAL-MODELS.md)
- [QDRANT-DEPLOYMENT.md](./QDRANT-DEPLOYMENT.md)

---

## First-Time Setup Rules

Pick the embedding profile before the database is created.

This is not cosmetic. The readable `nodes` and `chunks` tables are normal SQLite tables, but the derived vector tables are created with a fixed embedding width:

| Setup profile | Utility model | Embedding model | Vector width |
|---------------|---------------|-----------------|--------------|
| `openai` | `gpt-4o-mini` | `text-embedding-3-small` | `1536` |
| `qwen-local` | `qwen3:4b` through Ollama | `qwen3-embedding:0.6b` through Ollama | `1024` |
| `llama-cpp` | `qwen3-4b` through llama.cpp | `qwen3-embedding-0.6b` through llama.cpp | `1024` |

Setup requires one of these commands on a fresh install.

OpenAI:

```bash
npm install
npm run setup:local -- --profile openai
npm run dev
```

Local Qwen with Ollama:

```bash
npm install
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
npm run setup:local -- --profile qwen-local
npm run dev
```

Local Qwen with llama.cpp:

```bash
npm install
npm run setup:local -- --profile llama-cpp
npm run dev
```

If you run setup without a profile and `.env.local` does not already select one, setup stops before creating vector tables and prints the supported commands.

If you change embedding provider, model, dimensions, or vector backend after data exists, your source data stays intact but derived embeddings must be rebuilt:

```bash
npm run rebuild:embeddings
```

---

## OpenAI API Key

Only applies to the `openai` setup profile.

Without a key, you can still create and organize nodes manually.

With a key, you get:
- Auto-generated descriptions when you add nodes
- Automatic node descriptions
- Semantic search (find similar content, not just keyword matches)

**Cost:** Less than $0.10/day for heavy use. Most users spend $1-2/month.

**Setup:** The install script will prompt for your key during setup, or the app will prompt on first launch, or go to Settings -> API Keys.

Get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

If you selected `qwen-local` or `llama-cpp`, do not add an OpenAI key in the UI. Settings -> API Keys shows the active local model profile and disables OpenAI key entry so the install stays aligned with the setup profile.

---

## Local Model Profile

Use `qwen-local` or `llama-cpp` if you want local utility LLM calls and local embeddings.

RA-H does not bundle model weights. It calls local OpenAI-compatible HTTP endpoints. The tested local paths are Ollama with Qwen and llama.cpp with compatible Qwen GGUF files.

Supported Ollama contract:

```bash
LLM_PROFILE=openai-compatible
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=qwen3:4b

EMBEDDING_PROFILE=openai-compatible
EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
EMBEDDING_MODEL=qwen3-embedding:0.6b
EMBEDDING_DIMENSIONS=1024
```

Supported llama.cpp contract:

```bash
LLM_PROFILE=openai-compatible
LLM_BASE_URL=http://127.0.0.1:8080/v1
LLM_MODEL=qwen3-4b

EMBEDDING_PROFILE=openai-compatible
EMBEDDING_BASE_URL=http://127.0.0.1:8081/v1
EMBEDDING_MODEL=qwen3-embedding-0.6b
EMBEDDING_DIMENSIONS=1024
```

Runtime guides:

- [Ollama local profile](./OLLAMA-LOCAL-PROFILE.md)
- [llama.cpp local profile](./LLAMA-CPP-LOCAL-PROFILE.md)

Validate local AI and vector configuration:

```bash
npm run doctor:local-ai
```

If you change embedding provider, model, dimensions, or vector backend after data exists:

```bash
npm run rebuild:embeddings
```

Custom model/provider overrides are advanced and not a broad support guarantee. They may work, but the tested product surface is OpenAI plus the narrow local Qwen profiles.

---

## Vector Backends

Default:

```bash
VECTOR_BACKEND=sqlite-vec
```

Use Qdrant when sqlite-vec is unavailable or unreliable:

```bash
docker compose up -d qdrant
VECTOR_BACKEND=qdrant
QDRANT_URL=http://localhost:6333
```

SQLite remains the source-of-truth database. Qdrant stores only derived vector indexes.

Qdrant does not change your model choice. OpenAI vs local Qwen is controlled by `LLM_PROFILE` and `EMBEDDING_PROFILE`. sqlite-vec vs Qdrant is controlled by `VECTOR_BACKEND`.

---

## Where Your Data Lives

By default, setup creates and seeds the SQLite database in your operating system's app-data folder, not inside the cloned repo:

```
~/Library/Application Support/RA-H/db/rah.sqlite   # macOS
~/.local/share/RA-H/db/rah.sqlite                  # Linux
%APPDATA%/RA-H/db/rah.sqlite                       # Windows
```

This default applies to all app profiles:
- `npm run setup:local -- --profile openai`
- `npm run setup:local -- --profile qwen-local`
- `npm run setup:local -- --profile llama-cpp`

This is a standard SQLite file. You can:
- Back it up by copying the file
- Query it directly with `sqlite3` or any SQLite tool
- Move it between machines

You can put the database somewhere else by setting `SQLITE_DB_PATH` before setup. Use this when you want a repo-local DB, a demo DB, or any other separate database:

```bash
SQLITE_DB_PATH="$HOME/Desktop/ra-h_os-demo-data/rah.sqlite" npm run setup:local -- --profile qwen-local
```

To put it directly inside your cloned repo, use a gitignored local folder:

```bash
SQLITE_DB_PATH="$PWD/.ra-h/db/rah.sqlite" npm run setup:local -- --profile qwen-local
```

If MCP should use that same non-default database, pass the same path to the MCP installer:

```bash
npx -y ra-h-mcp-server@latest setup --client claude-code,codex --yes --db "$HOME/Desktop/ra-h_os-demo-data/rah.sqlite"
```

---

## Point MCP At The Right Database

The MCP server reads and writes whichever SQLite file is set as `RAH_DB_PATH`.

Use the same database path for the app and for MCP. If these paths do not match, the browser UI and your coding agent will be looking at different graphs.

### Default Database

If you used the default app-data database, install MCP without `--db`:

```bash
npx -y ra-h-mcp-server@latest setup --client claude-code,codex --yes
```

That points MCP at the default platform path:

```text
~/Library/Application Support/RA-H/db/rah.sqlite   # macOS
~/.local/share/RA-H/db/rah.sqlite                  # Linux
%APPDATA%/RA-H/db/rah.sqlite                       # Windows
```

### Custom Or Repo-Local Database

If you set `SQLITE_DB_PATH` during app setup, pass that exact same path to the MCP installer with `--db`.

Example repo-local app setup:

```bash
SQLITE_DB_PATH="$PWD/.ra-h/db/rah.sqlite" npm run setup:local -- --profile qwen-local
```

Matching MCP setup:

```bash
npx -y ra-h-mcp-server@latest setup \
  --client claude-code,codex \
  --yes \
  --db "$PWD/.ra-h/db/rah.sqlite"
```

### Project-Scoped Claude Code MCP

If you want Claude Code to use a repo-local database only inside this repo, create a project `.mcp.json`:

```json
{
  "mcpServers": {
    "ra-h": {
      "command": "npx",
      "args": ["-y", "ra-h-mcp-server@latest"],
      "env": {
        "RAH_DB_PATH": "/absolute/path/to/ra-h_os/.ra-h/db/rah.sqlite"
      }
    }
  }
}
```

Use the server name `ra-h` in project config if you want the project database to override a user-level `ra-h` server while Claude is opened in that repo.

Keep `.mcp.json` out of git if it contains a machine-specific path.

### Verify The Active MCP Database

After configuring MCP, fully restart the client.

Then run:

```bash
npx -y ra-h-mcp-server@latest doctor --db "/path/to/rah.sqlite"
```

Inside your agent, ask it to use the RA-H MCP server and report the database path it is using before it creates or updates nodes.

---

## Demo-safe isolated install

If you need a clean demo without touching your normal RA-H database:

```bash
git clone https://github.com/bradwmorris/ra-h_os.git ~/Desktop/ra-h_os-demo
cd ~/Desktop/ra-h_os-demo
npm install
SQLITE_DB_PATH="$HOME/Desktop/ra-h_os-demo-data/rah.sqlite" npm run setup:local -- --profile qwen-local
npm run dev

npx -y ra-h-mcp-server@latest setup \
  --client claude-code,codex \
  --yes \
  --install-rules \
  --target "$HOME/Desktop/ra-h_os-demo" \
  --db "$HOME/Desktop/ra-h_os-demo-data/rah.sqlite"
```

## Connect Claude Code (or other MCP clients)

The recommended path is the CLI installer:

```bash
npx -y ra-h-mcp-server@latest setup --client claude-code --yes
```

If your app uses a custom database path, include `--db` with that exact path. See [Point MCP At The Right Database](#point-mcp-at-the-right-database).

Manual config is still useful for troubleshooting or unsupported clients. Add this to your MCP client config and restart the client fully:


```json
{
  "mcpServers": {
    "ra-h": {
      "command": "npx",
      "args": ["-y", "ra-h-mcp-server@latest"]
    }
  }
}
```

Restart Claude Code fully (**Cmd+Q on Mac**, not just closing the window).

If you need a frozen version for debugging, pin it explicitly and restart the client.

**Verify it worked:** Ask Claude `Do you have RA-H tools available?` You should see tools like `queryNodes`, `retrieveQueryContext`, `createNode`, and `readSkill`.

**For contributors** testing local changes, use the local path instead:
```json
{
  "mcpServers": {
    "ra-h": {
      "command": "node",
      "args": ["/absolute/path/to/ra-h_os/apps/mcp-server-standalone/index.js"]
    }
  }
}
```

**What happens:** Once connected, the agent should use `queryNodes` for specific existing-node lookup, `retrieveQueryContext` when broader graph grounding would help, and `getContext` only for orientation. It should search before creating, propose durable writeback selectively instead of pestering, and treat the graph itself as the source of grounding rather than a separate contexts layer. The MCP server stores source on the node. The app later turns that source into chunks and embeddings.

**Recommended memory file:** If you use Claude Code or another coding agent, add one short repo-level memory file (`AGENTS.md` or `CLAUDE.md`) that reinforces the core graph behavior. Keep it simple and do not maintain conflicting versions across multiple files.

Suggested snippet:

```md
## RA-H Graph Memory

You are helping build a thoughtful graph of atomic units of context.

- Use `queryNodes` for direct lookup of a specific existing node.
- Use `retrieveQueryContext` when broader graph context would help with the current turn.
- Search before creating. Prefer updating the same artifact when it is clearly the same thing.
- `description` should state plainly what the thing is first, then why it belongs and current status.
- Preserve the user's wording in `source` for user-authored ideas unless they explicitly want a rewrite.
```

Or install that guidance into the repo memory file:

```bash
npx -y ra-h-mcp-server@latest install-rules --client claude-code,codex --target . --yes
```

Available tools:

| Tool | What it does |
|------|--------------|
| `getContext` | Get graph overview — stats, hub nodes, skills, and orientation signals |
| `retrieveQueryContext` | Pull relevant graph context for a broader current-turn task |
| `queryNodes` | Find nodes by keyword |
| `createNode` | Create a new node |
| `getNodesById` | Fetch nodes by ID |
| `updateNode` | Edit an existing node |
| `createEdge` | Link two nodes together after explicit confirmation |
| `updateEdge` | Update an edge explanation after explicit confirmation |
| `queryEdge` | Find connections |
| `listSkills` | List available skills |
| `readSkill` | Read a skill by name |
| `writeSkill` | Create or update a custom skill |
| `deleteSkill` | Delete a custom skill |
| `searchContentEmbeddings` | Search through source content (transcripts, books, articles) |
| `sqliteQuery` | Run read-only SQL queries (SELECT/WITH/PRAGMA) |

**Example prompts for Claude Code:**
- "What's in my knowledge graph?"
- "Search my knowledge base for notes about React performance"
- "Add a node about the article I just read on transformers"
- "Show me the nodes connected to this project idea"

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

See [docs/2_schema.md](./docs/2_schema.md) and [docs/8_mcp.md](./docs/8_mcp.md) for the current contract.

---

## Commands

| Command | What it does |
|---------|--------------|
| `npm run setup:local -- --profile openai` | Rebuild native modules, create `.env.local`, create the SQLite DB, and seed OpenAI-width vector tables |
| `npm run setup:local -- --profile qwen-local` | Rebuild native modules, create `.env.local`, create the SQLite DB, and seed Qwen-width vector tables |
| `npm run setup:local -- --profile llama-cpp` | Rebuild native modules, create `.env.local`, create the SQLite DB, and seed Qwen-width vector tables for llama.cpp endpoints |
| `npm run setup:local` | Only valid if `.env.local` already selects an embedding profile; otherwise it stops before DB/vector setup |
| `npm run bootstrap:local` | Lower-level helper used by `setup:local`; most users should not run this directly |
| `npm run rebuild:embeddings` | Recreate derived embeddings after changing embedding provider, model, dimensions, or vector backend |
| `npm run dev` | Start the app at localhost:3000 |
| `npm run dev:local` | Alias for `npm run dev` |
| `npm run build` | Production build |
| `npm run type-check` | Check TypeScript |

---

## Windows

Windows support is now being validated against real user setups.

The latest runtime update is intended to make the core local/web app work on Windows even if vector search is not configured yet:
- the app should still start
- nodes, UI, and keyword/FTS search should still work
- `/api/health/vectors` should report vector search as unavailable instead of crashing

For semantic/vector search on Windows:
1. Go to [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases)
2. Download the Windows x64 release (for example `sqlite-vec-0.1.6-loadable-windows-x86_64.zip`)
3. Extract `vec0.dll`
4. Copy it to `vendor/sqlite-extensions/vec0.dll` in this repo
5. Re-run the normal local setup steps

Without `vec0.dll`, the core app should still work, but semantic/vector search will be unavailable.

## Linux

Linux support depends on which Linux environment you are running.

For standard Linux x64 distributions that use glibc (Ubuntu, Debian, Fedora, etc.), the core app should work and sqlite-vec can be added like this:
1. Go to [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases)
2. Download the Linux release matching your architecture (for example `sqlite-vec-0.1.6-loadable-linux-x86_64.tar.gz`)
3. Extract `vec0.so`
4. Copy it to `vendor/sqlite-extensions/vec0.so` in this repo
5. Re-run the normal local setup steps

For Alpine/musl environments, sqlite-vec is the problem case. The core app may still run, but sqlite-vec is not the reliable path there. Qdrant is the intended backend for that deployment target.

Without sqlite-vec:
- the core app should still start
- nodes, UI, and keyword/FTS search should still work
- `/api/health/vectors` should report vector search as unavailable instead of crashing

---

## Community

- **Discord:** [discord.gg/3cpQj6Jtc9](https://discord.gg/3cpQj6Jtc9) — ask questions, share your setup, get help
- **Repo docs:** [docs/README.md](./docs/README.md)
- **Issues:** [github.com/bradwmorris/ra-h_os/issues](https://github.com/bradwmorris/ra-h_os/issues)
- **License:** MIT
