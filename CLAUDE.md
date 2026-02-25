# CLAUDE.md — Agent Instructions for memoryd

## Workflow: Git Worktrees

All work MUST be done in fresh git worktrees. Never work directly on `main`.

### Starting work

1. Ensure an issue exists (or create one) for the work being done.
2. Create a fresh worktree from the latest `main`:
   ```sh
   git fetch origin
   git worktree add ../memoryd-<short-name> -b <branch-name> origin/main
   ```
   Branch naming: `feat/<topic>`, `fix/<topic>`, or `chore/<topic>`.
3. Work inside the worktree directory for all changes.

### Before asking to move forward

Every PR must pass all of these before requesting review:

```sh
bun run build          # Zero TypeScript errors
bun test .spec.ts      # All tests pass
bun run lint           # Zero ESLint warnings/errors (--max-warnings 0)
```

All new or changed behavior must have corresponding tests. Do not skip tests.

### Submitting work

1. Commit with clear, conventional commit messages (`feat:`, `fix:`, `refactor:`, `chore:`, `test:`, `docs:`).
2. Push the branch and open a PR with `gh pr create`. The PR body must include:
   - A summary of what changed and why.
   - Confirmation that build, test, and lint all pass.
3. Do NOT ask to move forward until the PR is open and all checks pass.

### After merge

1. Delete the worktree and the local branch:
   ```sh
   git worktree remove ../memoryd-<short-name>
   git branch -d <branch-name>
   ```
2. New work starts in a new fresh worktree. Never reuse old worktrees.

## Project Context

- **Language**: TypeScript (ESM-only, `"type": "module"`).
- **Runtime**: Bun.
- **Build**: `bun run build` (`tsc` via `build:esm`).
- **Test**: `bun test .spec.ts`.
- **Lint**: `bun run lint` (ESLint with `@typescript-eslint`, `@stylistic`, `--max-warnings 0`).
- **SDK**: Uses `@enbox/api`, `@enbox/crypto`, `@enbox/dids`, `@enbox/dwn-sdk-js`. Never reference `@web5/*` or `tbddev.org`.
- **MCP**: Uses `@modelcontextprotocol/sdk` for the MCP server (Zod schemas for tool inputs).
- **Vector**: Uses `sqlite-vec` (via `bun:sqlite`) for vector similarity search, FTS5 for full-text.
- **Exports**: Single entry point via `./dist/esm/index.js`. Sub-path exports for `@enbox/memoryd/mcp` and `@enbox/memoryd/sidecar`. CLI binary: `memoryd`.
- **Style**: Explicit return types required (`@typescript-eslint/explicit-function-return-type`). Colon-aligned key-spacing. Single quotes. Semicolons required.

### Implemented features

- **Three DWN protocols** — `memory/v1` (facts, preferences, relationships, collections, supersessions), `task-graph/v1` (tasks with subtasks up to 3 levels, dependencies, status changes, notes), `memory-audit/v1` (immutable action log).
- **Core stores** — `MemoryStore` (facts, preferences, relationships with CRUD + supersession), `TaskStore` (tasks, subtasks, dependencies, notes, status transitions, claim), `GraphEngine` (ready-task calculation, cycle detection, transitive blockers/dependants, subtask trees).
- **Sidecar search** — `SidecarDatabase` (SQLite lifecycle with sqlite-vec + FTS5 + task graph cache + sync tracking), `SearchIndex` (hybrid search with Reciprocal Rank Fusion combining vector KNN and FTS5 BM25).
- **Embedding providers** — `NoopProvider` (zero vectors for testing/FTS-only), `OllamaProvider` (local Ollama REST API, default `nomic-embed-text`), `OpenAIProvider` (`text-embedding-3-small`). Factory via `createEmbeddingProvider()`.
- **MCP server** — `MemorydServer` with stdio and HTTP (Bun.serve + Web-Standard Streamable HTTP) transports. 12 tools, 5 resources, 2 prompts.
- **CLI** — Commands: `init`, `serve`, `fact` (add/list/search), `task` (create/list/ready/show/update/dep/note). Hand-rolled flag parsing. `--json` output mode. Password via `--password` or `MEMORYD_PASSWORD` env var.

## Architecture

### Source of truth: DWN

All user data lives in DWN records, encrypted with JWE (where `encryptionRequired: true`). The DWN is the canonical store. Everything else (SQLite sidecar, in-memory caches) is a rebuildable projection.

### Typed protocol system

Protocols are defined with the `as const satisfies ProtocolDefinition` pattern, then wrapped with `defineProtocol<Def, SchemaMap>()` from `@enbox/api`. This produces a `TypedProtocol` that enables type-safe record operations:

```ts
const typed = web5.using(MemoryProtocol);   // TypedWeb5<MemoryDef, MemoryMap>
await typed.configure({ encryption: true });
const { record } = await typed.records.create('fact', { data, tags, encryption: true });
```

Each protocol definition declares:
- **types** — record schemas, data formats, `encryptionRequired` flags.
- **structure** — hierarchy (e.g. `task/task/task` for 3-level subtasks, `fact/supersession`), `$tags` with required/optional tag definitions, `$actions` for role-based access, `$immutable` for append-only records.
- **SchemaMap** — TypeScript type mapping protocol type names to their data shapes.

### Encryption pattern

Identities use `did:dht` with two verification methods:
- `Ed25519` (`sig`) — for `assertionMethod` + `authentication`.
- `X25519` (`enc`) — for `keyAgreement`, enabling JWE encryption.

Records with `encryptionRequired: true` (facts, preferences, relationships, tasks) are encrypted at rest. Sub-records like dependencies, status changes, supersessions, and notes are not encrypted (they contain only metadata/references).

### Sidecar: rebuildable search index

The SQLite sidecar (`~/.memoryd/index.db`) is an ephemeral cache with:
- **`memory_embeddings`** — sqlite-vec virtual table for KNN vector search.
- **`memory_fts`** — FTS5 virtual table for BM25 full-text search.
- **`task_graph` / `task_status`** — denormalized task dependency graph.
- **`sync_state`** — cursor tracking for incremental DWN sync.

`SearchIndex.search()` runs hybrid search: vector KNN + FTS5 BM25, merged with Reciprocal Rank Fusion (RRF, k=60). Post-filters on `protocolPath`, `category`, `collection`.

### MCP tool registration

Tools use `server.mcp.registerTool(name, { description, inputSchema }, handler)` where `inputSchema` is a Zod schema object (not JSON Schema). Each tool handler returns `{ content: [{ type: 'text', text }] }` or `{ isError: true, ... }`. Every write operation calls `writeAudit()` to produce an immutable audit log record.

Resources use `server.mcp.registerResource(name, uriOrTemplate, metadata, handler)`. Template resources use `new ResourceTemplate('memory://tasks/{id}', { list: undefined })`.

Prompts use `server.mcp.registerPrompt(name, { description, argsSchema }, handler)`.

### MCP server transports

- **stdio** — `startStdio()` for CLI/pipe integration (most MCP clients).
- **HTTP** — `startHttp()` using Bun.serve with `WebStandardStreamableHTTPServerTransport`. Endpoints: `/mcp` (MCP protocol), `/health` (JSON status).

### Key directories

```
src/
  protocols/
    memory.ts        # memory/v1 — facts, preferences, relationships, collections, supersessions
    task-graph.ts    # task-graph/v1 — tasks (3-level nesting), deps, status changes, notes
    audit.ts         # memory-audit/v1 — immutable action log
  core/
    memory-store.ts  # MemoryStore — CRUD for facts, preferences, relationships + supersession
    task-store.ts    # TaskStore — CRUD for tasks, subtasks, deps, notes, status transitions
    graph.ts         # GraphEngine — ready tasks, cycle detection, blockers, dependants, subtree
  sidecar/
    database.ts      # SidecarDatabase — SQLite lifecycle (vec0, FTS5, task graph, sync state)
    search.ts        # SearchIndex — hybrid vector+FTS search with RRF
    embeddings.ts    # EmbeddingProvider interface + Noop, Ollama, OpenAI implementations
    index.ts         # Barrel export for @enbox/memoryd/sidecar
  mcp/
    server.ts        # MemorydServer — stdio + HTTP transports
    tools/
      memory-tools.ts  # memory_add_fact, memory_add_preference, memory_search,
                       # memory_supersede, memory_compact (5 tools)
      task-tools.ts    # task_create, task_update, task_add_dependency, task_ready,
                       # task_show, task_list, task_add_note (7 tools)
    resources/
      memory-resources.ts  # memory://facts, memory://facts/{id} (2 resources)
      task-resources.ts    # memory://tasks, memory://tasks/ready, memory://tasks/{id} (3 resources)
    prompts/
      context-prompt.ts  # context — inject relevant memories
      plan-prompt.ts     # plan — task decomposition template
    index.ts         # Barrel export for @enbox/memoryd/mcp
  cli/
    main.ts          # CLI entry point and command router
    agent.ts         # Web5 bootstrap, AgentContext type
    flags.ts         # Hand-rolled flag parsing (flagValue, hasFlag, parsePort)
    commands/
      init.ts        # Install protocols, verify readiness
      serve.ts       # Start MCP HTTP server
      fact.ts        # fact add/list/search
      task.ts        # task create/list/ready/show/update/dep/note
  index.ts           # Barrel export for @enbox/memoryd
schemas/             # JSON Schema files (fact, preference, relationship, collection,
                     # supersession, task, dependency, status-change, note, action-log)
tests/               # Integration tests (.spec.ts), mirrors src/ structure
```

## Test patterns

### Agent setup

Tests that interact with DWN create a `Web5UserAgent` with `did:dht` and X25519 key agreement:

```ts
const agent = await Web5UserAgent.create({ dataPath: DATA_PATH });
await agent.initialize({ password: 'test' });
await agent.start({ password: 'test' });

const identity = await agent.identity.create({
  didMethod: 'dht',
  metadata: { name: 'Test' },
  didOptions: {
    verificationMethods: [
      { algorithm: 'Ed25519', id: 'sig', purposes: ['assertionMethod', 'authentication'] },
      { algorithm: 'X25519', id: 'enc', purposes: ['keyAgreement'] },
    ],
  },
});

const { web5 } = await Web5.connect({ agent, connectedDid: identity.did.uri, sync: 'off' });
```

### Data directories

Each test suite uses a unique `__TESTDATA__/<name>` directory for LevelDB storage. Cleaned up in `beforeAll` (before run) and `afterAll` (after run) with `rmSync(DATA_PATH, { recursive: true, force: true })`.

### MCP tool/resource/prompt tests

MCP tests start a real `MemorydServer` on port 0 (auto-assign), then connect with the MCP Client SDK:

```ts
const client = new Client({ name: 'test', version: '0.0.1' });
await client.connect(new StreamableHTTPClientTransport(
  new URL(`http://localhost:${port}/mcp`),
));
const result = await client.callTool({ name: 'memory_add_fact', arguments: { ... } });
```

### Sidecar tests

Sidecar tests use `NoopProvider` for embeddings (zero vectors) so they run without an external embedding service. They test FTS5 matching and the hybrid RRF merge logic.

## Rules

- No workarounds. Fix root causes.
- No monkey-patching SDK internals.
- No hardcoded DIDs or gateway URLs in source code. Use env vars or config.
- No committing secrets (`.env`, credentials, private keys, `*.db`).
- Keep PRs focused. One concern per PR.
- The DWN is always the source of truth. The sidecar SQLite is a rebuildable cache.
- Every agent write must produce an audit log record.
- Use `import type` for type-only imports.
- Use the `as const satisfies ProtocolDefinition` pattern for protocol definitions.
