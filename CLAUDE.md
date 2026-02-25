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
- **MCP**: Uses `@modelcontextprotocol/sdk` for the MCP server.
- **Vector**: Uses `sqlite-vec` (via `bun:sqlite`) for vector similarity search, FTS5 for full-text.
- **Exports**: Single entry point via `./dist/esm/index.js`. CLI binary: `memoryd`.
- **Style**: Explicit return types required (`@typescript-eslint/explicit-function-return-type`). Colon-aligned key-spacing. Single quotes. Semicolons required.

## Architecture

- **Source of truth**: DWN records (JWE-encrypted, user-owned).
- **Search index**: Local SQLite sidecar (`~/.memoryd/index.db`) with sqlite-vec + FTS5. Ephemeral — rebuildable from DWN.
- **MCP server**: HTTP/SSE transport, persistent daemon, multi-client.
- **Three DWN protocols**: `memory/v1` (facts, preferences), `task-graph/v1` (tasks, deps), `memory-audit/v1` (action log).

### Key directories

```
src/
  protocols/       # DWN protocol definitions (defineProtocol)
  core/            # Business logic: memory-store, task-store, graph engine
  sidecar/         # SQLite + sqlite-vec + FTS5 search index
  mcp/             # MCP server, tools, resources, prompts
  cli/             # CLI entry point and command handlers
schemas/           # JSON Schema files for record types
tests/             # Test files (.spec.ts)
```

## Rules

- No workarounds. Fix root causes.
- No monkey-patching SDK internals.
- No hardcoded DIDs or gateway URLs in source code. Use env vars or config.
- No committing secrets (`.env`, credentials, private keys, `*.db`).
- Keep PRs focused. One concern per PR.
- The DWN is always the source of truth. The sidecar SQLite is a rebuildable cache.
- Every agent write must produce an audit log record.
