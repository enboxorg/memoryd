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
# Initialize memory protocols on your DWN
memoryd init

# Start the MCP server (HTTP/SSE, default port 3200)
memoryd serve

# Add to your Claude Desktop config:
# {
#   "mcpServers": {
#     "memoryd": {
#       "url": "http://localhost:3200/sse"
#     }
#   }
# }
```

## CLI

```bash
# Memory
memoryd fact add "Prefers TypeScript over JavaScript" --category coding
memoryd fact add "Uses Neovim with LazyVim config" --category tools
memoryd fact list --category coding
memoryd fact search "development preferences"

# Tasks (beads-compatible UX)
memoryd task create "Implement auth module" -p p1 -t feature
memoryd task create "Add JWT validation" -p p2 --parent <task-id>
memoryd task dep add <child-id> <parent-id>
memoryd task ready                          # Tasks with no open blockers
memoryd task update <id> --claim            # Atomic: set assignee + in_progress
memoryd task show <id>                      # Detail with deps, subtasks, history
memoryd task list --status open

# Maintenance
memoryd compact --older-than 30d            # Memory decay / summarization
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

### Audit

| Tool | Description |
|---|---|
| `memory_audit` | View agent action log |

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
                  MCP Protocol (HTTP/SSE)
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
- Configurable embedding provider (local Ollama default, OpenAI optional)
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

## Configuration

```jsonc
// ~/.memoryd/config.json
{
  "server": {
    "port": 3200
  },
  "embedding": {
    "provider": "local",           // "local" | "ollama" | "openai" | "custom"
    "model": "nomic-embed-text",
    "dimensions": 768
  },
  "sidecar": {
    "path": "~/.memoryd/index.db"
  }
}
```

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
- [ ] v0.1: Protocol definitions, core stores, MCP server, CLI
- [ ] v0.2: Vector sidecar with sqlite-vec, hybrid search
- [ ] v0.3: Memory compaction, consent/revocation, audit UI
- [ ] v1.0: Conversation memory layer (chat-derived memory extraction)

## Status

Early development. See [issues](https://github.com/enboxorg/memoryd/issues) for the implementation plan.
