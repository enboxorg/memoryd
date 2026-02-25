# memoryd

> **Research preview** — this project is under active development and not yet ready for production use. APIs, protocols, and CLI commands may change without notice.

User-owned AI memory layer built on [DWN](https://github.com/enboxorg/enbox) protocols. Persistent memory for AI agents — facts, preferences, and a dependency-aware task graph — exposed as an MCP server. Your data stays on your DWN. Any AI client can connect.

## Why

AI products are memory silos. User context is trapped per app, switching tools resets utility, and no one gives you control over what agents remember. `memoryd` fixes this:

- **You own your memory** — facts, preferences, tasks, and history live on your DWN under your DID. Not on OpenAI's servers, not in a vendor's database.
- **Any AI client can connect** — Claude Desktop, Cursor, VS Code Copilot, or any MCP-compatible client gets persistent memory by connecting to one daemon.
- **No cold start** — switch AI tools without re-explaining yourself. Consented memory follows you.
- **Task graph with teeth** — dependency-aware task tracking inspired by [Beads](https://github.com/steveyegge/beads). Agents can plan, decompose, track, and close structured work across sessions.
- **Semantic search** — local vector sidecar (sqlite-vec + FTS5) for hybrid retrieval. Agents find relevant memories by meaning, not just keywords.
- **Encrypted by default** — DWN records are JWE-encrypted. The local search index is ephemeral and rebuildable.
- **Revocable access** — grant scoped capabilities to agents via Web5 Connect. Revoke any time.

## Install

```bash
# Install via bun/npm
bun add -g @enbox/memoryd

# Or curl installer (coming soon)
curl -fsSL https://memoryd.sh/install | bash
```

## Quick start

```bash
# Create an identity (first time)
memoryd auth login

# Initialize memory protocols on your DWN
memoryd init --password <your-password>

# Start the MCP server (default port 3200)
memoryd serve --password <your-password>

# Or use the env var to avoid interactive prompts:
export MEMORYD_PASSWORD=<your-password>
memoryd init
memoryd serve
```

Connect your MCP client (Claude Desktop, Cursor, etc.):
```bash
memoryd mcp install   # auto-detects and configures your client
```

## CLI

```bash
# Memory
memoryd fact add "Prefers TypeScript over JavaScript" --category coding
memoryd fact add "Uses Neovim with LazyVim config" --category tools
memoryd fact list --category coding
memoryd fact search "development preferences"

# Tasks (beads-compatible UX)
memoryd task create "Implement auth module" --priority p1 --type feature
memoryd task create "Add JWT validation" --priority p2 --parent <task-id>
memoryd task dep add <child-id> <parent-id>
memoryd task ready                          # Tasks with no open blockers
memoryd task update <id> --claim            # Atomic: set assignee + in_progress
memoryd task show <id>                      # Detail with deps, subtasks, history
memoryd task list --status open

# Maintenance
memoryd compact                              # Memory decay / summarization
memoryd audit                               # Agent action log
memoryd revoke <agent-did>                  # Revoke agent access
```

## MCP Tools

When connected as an MCP server, memoryd exposes these tools to AI agents:

### Personal memory

| Tool | Description |
|---|---|
| `memory_add_fact` | Store a durable fact about the user |
| `memory_add_preference` | Store a user preference |
| `memory_search` | Hybrid search (vector + full-text + tag filters) |
| `memory_supersede` | Replace a fact, keeping history |
| `memory_compact` | Summarize and archive old memories |

### Task graph

| Tool | Description |
|---|---|
| `task_create` | Create a task with priority, type, optional parent |
| `task_update` | Update status, priority, assignee; `claim` for atomic grab |
| `task_add_dependency` | Link tasks (blocks, relates_to, duplicates, supersedes) |
| `task_ready` | List tasks with no open blockers |
| `task_show` | Full task detail with subtasks, deps, status history |
| `task_list` | Filtered task list |
| `task_add_note` | Annotate a task |

## MCP Resources

| URI | Description |
|---|---|
| `memory://facts` | List facts (filterable) |
| `memory://facts/{id}` | Single fact with supersession chain |
| `memory://tasks` | Task list (filterable) |
| `memory://tasks/ready` | Unblocked tasks |
| `memory://tasks/{id}` | Task detail with full graph |

## Architecture

```
                     MCP Clients
                 (Claude, Cursor, etc.)
                       |
                   MCP Protocol (stdio / HTTP)
                       |
                 +-----------+
                 |  memoryd  |
                 |  daemon   |
                 +-----------+
                       |
          +------------+------------+
          |            |            |
    MCP Server    CLI Handler   HTTP API
          |            |            |
          +------------+------------+
                       |
              +--------+--------+
              |   Core Logic    |
              |  (TypeScript)   |
              +--------+--------+
                       |
          +------------+------------+
          |            |            |
    DWN Client    Vector Sidecar   Embedding
    (@enbox/api)  (bun:sqlite +    Provider
          |        sqlite-vec +    (local/API)
          |        FTS5)                |
          |            |            |
     User's DWN    ~/.memoryd/     Ollama /
     (source of    index.db        OpenAI /
      truth)       (local cache)   etc.
```

### Two-layer data model (v1)

**Layer 1 — Personal memory** (`https://enbox.org/protocols/memory/v1`):
Facts, preferences, relationships. Durable user knowledge that agents can read/write under scoped consent. Append-only with supersession chains for history.

**Layer 2 — Task graph** (`https://enbox.org/protocols/task-graph/v1`):
Structured tasks with priority, type, hierarchy, and dependency links. Immutable status change audit trail. Inspired by [Beads](https://github.com/steveyegge/beads) — same mental model (`create`, `claim`, `ready`, dependency graph), backed by DWN records instead of local SQLite.

### Vector sidecar

The DWN is the source of truth (encrypted, portable, synced). The local SQLite sidecar is an ephemeral search index:

- **sqlite-vec** for vector similarity search (KNN)
- **FTS5** for full-text search
- **Reciprocal rank fusion** merges results from both
- Configurable embedding provider (noop default, Ollama or OpenAI optional)
- Rebuildable from DWN records at any time — it's a cache, not a store

### Encryption model

```
DWN records ──> JWE encrypted at rest (user's DID keys)
                     |
              memoryd decrypts locally (has agent keys)
                     |
              Generates embeddings from plaintext
                     |
              Stores in local SQLite sidecar
              (encrypted at rest via OS disk encryption)
              (ephemeral — rebuildable from DWN)
```

The sidecar never leaves the device. The DWN records are the portable, sovereign data.

## Search Setup

memoryd uses **hybrid search** that combines vector similarity (sqlite-vec) with full-text keyword matching (FTS5) via reciprocal rank fusion. The quality of vector search depends on the configured embedding provider.

Three embedding providers are available, configured via the `MEMORYD_EMBEDDING_PROVIDER` environment variable:

### `noop` (default)

No external dependencies required. Only keyword (FTS5) search produces meaningful results. Vector/semantic search returns arbitrary results because all embeddings are zero vectors.

This is the default so that `memoryd init && memoryd serve` works out of the box without any extra setup, but you will want to switch to a real provider for full hybrid search.

### `ollama` — free, local, private

Requires [Ollama](https://ollama.com) running locally with an embedding model pulled:

```sh
# Install Ollama: https://ollama.com
ollama pull nomic-embed-text
export MEMORYD_EMBEDDING_PROVIDER=ollama
memoryd serve
```

The default model is `nomic-embed-text` (768 dimensions). You can override with:

```sh
export MEMORYD_EMBEDDING_MODEL=<model-name>
export MEMORYD_EMBEDDING_URL=http://localhost:11434   # default
export MEMORYD_EMBEDDING_DIMENSIONS=768               # default
```

### `openai` — cloud-based

Requires an OpenAI API key:

```sh
export MEMORYD_EMBEDDING_PROVIDER=openai
export OPENAI_API_KEY=sk-...
memoryd serve
```

The default model is `text-embedding-3-small` (1536 dimensions). You can override with:

```sh
export MEMORYD_EMBEDDING_MODEL=text-embedding-3-large
export MEMORYD_EMBEDDING_DIMENSIONS=3072
```

## Configuration

All runtime settings are configured via environment variables:

| Variable | Default | Description |
|---|---|---|
| `MEMORYD_PASSWORD` | — | Vault password (or use `--password` flag) |
| `MEMORYD_EMBEDDING_PROVIDER` | `noop` | Embedding provider: `noop`, `ollama`, `openai` |
| `MEMORYD_EMBEDDING_MODEL` | provider default | Embedding model name |
| `MEMORYD_EMBEDDING_DIMENSIONS` | provider default | Embedding vector dimensions |
| `MEMORYD_EMBEDDING_URL` | `http://localhost:11434` | Ollama endpoint URL |
| `OPENAI_API_KEY` | — | OpenAI API key (when using `openai` provider) |
| `MEMORYD_SIDECAR_PATH` | `~/.memoryd/index.db` | Path to the sidecar SQLite database |
| `MEMORYD_DWN_ENDPOINT` | `https://enbox-dwn.fly.dev` | DWN service endpoint for new identities |
| `MEMORYD_HOST` | `localhost` | HTTP server bind host |
| `MEMORYD_PORT` | `3200` | HTTP server port |

## How this compares

|  | memoryd | Beads (bd) | Mem0 | ChatGPT Memory |
|---|---|---|---|---|
| Task graph | Yes | Yes | No | No |
| Personal memory | Yes | No | Yes | Yes |
| User-owned | Yes (DWN) | Partly (git) | No (SaaS) | No |
| Cross-app | Yes (MCP + DWN) | No (per-repo) | Partial (API) | No |
| Encrypted | Yes (JWE + sidecar) | No | No | At rest only |
| Vector search | sqlite-vec (local) | None | Qdrant (server) | Proprietary |
| MCP server | Yes (native) | Community plugins | Community plugin | No |
| Consent model | Yes (Web5 Connect) | No | No | No |

## DWN Protocols

memoryd installs three protocols on the user's DWN:

- `https://enbox.org/protocols/memory/v1` — facts, preferences, relationships, collections
- `https://enbox.org/protocols/task-graph/v1` — tasks, subtasks, dependencies, status changes
- `https://enbox.org/protocols/memory-audit/v1` — immutable agent action log

## Roadmap

- [x] Design: personal memory + task graph + vector sidecar
- [x] v0.1: Protocol definitions, core stores, MCP server, CLI
- [x] v0.2: Vector sidecar with sqlite-vec, hybrid search
- [x] v0.3: Memory compaction, consent/revocation, audit logging
- [ ] v1.0: Conversation memory layer (chat-derived memory extraction)

## Status

Research preview (v0.0.1). Core functionality is complete — protocols, stores, MCP server (12 tools, 5 resources, 2 prompts), CLI, hybrid search, audit logging, and consent management are all implemented and tested. See [issues](https://github.com/enboxorg/memoryd/issues) for remaining work.
