# @enbox/memoryd

## 0.1.1

### Patch Changes

- [#61](https://github.com/enboxorg/memoryd/pull/61) [`77b520c`](https://github.com/enboxorg/memoryd/commit/77b520cc001e130da01493a2c249f49c5707d836) Thanks [@LiranCohen](https://github.com/LiranCohen)! - Gracefully handle sqlite-vec extension loading failure — falls back to FTS5-only search when the SQLite build lacks dynamic extension loading support (e.g. some Bun versions on macOS).

## 0.1.0

### Minor Changes

- [#59](https://github.com/enboxorg/memoryd/pull/59) [`ee3a976`](https://github.com/enboxorg/memoryd/commit/ee3a976d688f3acedd8dd1032dfa2002ffbaaced) Thanks [@LiranCohen](https://github.com/LiranCohen)! - First functional release — full CLI, MCP server (12 tools, 5 resources, 2 prompts), DWN protocols, sidecar search, identity management, and task graph engine.
