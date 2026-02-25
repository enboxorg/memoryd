# AGENTS.md — Guide for AI Agents Using memoryd

This document is for AI agents that connect to memoryd as an MCP server. It covers configuration, available tools/resources/prompts, workflows, and best practices.

## Getting started

### Starting the server

```sh
# Initialize protocols (first time only)
memoryd init --password <your-password>

# Start the MCP HTTP server
memoryd serve --port 3200 --password <your-password>
```

The server listens on `http://localhost:3200` with two endpoints:
- `/mcp` — MCP protocol (Streamable HTTP transport)
- `/health` — JSON health check

### MCP configuration for Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memoryd": {
      "command": "memoryd",
      "args": ["serve", "--port", "3200", "--password", "your-password"],
      "env": {}
    }
  }
}
```

Or, if the server is already running:

```json
{
  "mcpServers": {
    "memoryd": {
      "url": "http://localhost:3200/mcp"
    }
  }
}
```

### MCP configuration for Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "memoryd": {
      "command": "memoryd",
      "args": ["serve", "--port", "3200", "--password", "your-password"]
    }
  }
}
```

## Available MCP tools (12)

### Memory tools

#### `memory_add_fact`

Store a new fact about the user.

| Parameter    | Type   | Required | Description                                |
|-------------|--------|----------|--------------------------------------------|
| `content`    | string | yes      | The fact content                           |
| `category`   | string | yes      | Category (e.g. `personal`, `work`, `health`, `technical`) |
| `source`     | string | no       | Source of the fact (default: `agent`)       |
| `confidence` | number | no       | Confidence score between 0 and 1           |
| `collection` | string | no       | Collection to group the fact into          |

**When to use:** The user tells you something about themselves, their preferences, their work, or their environment that would be useful to remember across conversations.

**Example:** User says "I use Neovim as my editor" — store as a fact with category `technical`.

#### `memory_add_preference`

Store a user preference.

| Parameter    | Type   | Required | Description                              |
|-------------|--------|----------|------------------------------------------|
| `content`    | string | yes      | The preference content                   |
| `domain`     | string | yes      | Domain (e.g. `ui`, `accessibility`, `communication`, `coding`) |
| `collection` | string | no       | Collection to group the preference into  |

**When to use:** The user expresses how they like things done — communication style, output format, coding conventions, etc.

**Example:** User says "Always use TypeScript strict mode" — store as a preference with domain `coding`.

#### `memory_search`

Search the user's memory store.

| Parameter    | Type   | Required | Description                                    |
|-------------|--------|----------|------------------------------------------------|
| `query`      | string | no       | Free-text search query (hybrid vector+FTS)     |
| `category`   | string | no       | Filter by fact category                        |
| `domain`     | string | no       | Filter by preference domain                    |
| `collection` | string | no       | Filter by collection                           |
| `limit`      | number | no       | Max results to return (default: 10, max: 100)  |

**How to search effectively:**
- Use natural language queries — the hybrid search combines semantic (vector) and keyword (FTS5) matching via Reciprocal Rank Fusion.
- Combine `query` with `category` or `collection` filters to narrow results.
- Without a `query`, returns a filtered list of facts sorted by creation date.

**Example:** Search for `"preferred programming languages"` with category `technical`.

#### `memory_supersede`

Replace an existing fact with updated content. The old fact is marked as `superseded` and linked to the new one.

| Parameter    | Type   | Required | Description                          |
|-------------|--------|----------|--------------------------------------|
| `oldFactId`  | string | yes      | Record ID of the fact to supersede   |
| `newContent` | string | yes      | The updated fact content             |
| `reason`     | string | no       | Reason for the supersession          |

**When to use:** The user corrects or updates a previously stored fact. Always supersede rather than delete — this preserves the audit trail.

**Example:** User previously said "I use VS Code" but now says "I switched to Neovim" — supersede the old fact.

#### `memory_compact`

Compact the memory store by merging or pruning old entries.

| Parameter    | Type   | Required | Description                                    |
|-------------|--------|----------|------------------------------------------------|
| `olderThan`  | string | no       | ISO 8601 date — compact records older than this |
| `collection` | string | no       | Limit compaction to a specific collection       |

**Note:** Not yet implemented (see Issue #15). Returns a status message.

### Task tools

#### `task_create`

Create a new task or subtask.

| Parameter      | Type   | Required | Description                              |
|---------------|--------|----------|------------------------------------------|
| `title`        | string | yes      | Title of the task                        |
| `priority`     | enum   | yes      | `p0`, `p1`, `p2`, or `p3`               |
| `description`  | string | no       | Detailed description                     |
| `type`         | string | no       | Task type: `epic`, `feature`, `bug`, `task`, `chore` |
| `parentTaskId` | string | no       | Parent task ID to create a subtask       |
| `collection`   | string | no       | Collection to group the task             |

**When to use:** The user wants to track a piece of work. Use `parentTaskId` to create subtasks under an epic or feature.

#### `task_update`

Update an existing task's status, priority, or assignee.

| Parameter  | Type    | Required | Description                                        |
|-----------|---------|----------|----------------------------------------------------|
| `taskId`   | string  | yes      | ID of the task to update                           |
| `status`   | string  | no       | New status: `open`, `in_progress`, `blocked`, `closed` |
| `priority` | string  | no       | New priority: `p0`-`p3`                            |
| `assignee` | string  | no       | Assignee DID or name                               |
| `claim`    | boolean | no       | If true, atomically claim (set `in_progress` + assignee) |

**Status transitions:** `open` -> `in_progress` -> `closed`. Use `blocked` when dependencies are unmet. Use `claim: true` to atomically set status to `in_progress` and assign in one operation.

#### `task_add_dependency`

Add a dependency between tasks with automatic cycle detection.

| Parameter   | Type   | Required | Description                        |
|------------|--------|----------|------------------------------------|
| `taskId`    | string | yes      | ID of the task that will be blocked |
| `dependsOn` | string | yes      | ID of the blocking task            |
| `type`      | string | no       | Dependency type (default: `blocks`). Also: `relates_to`, `duplicates`, `supersedes` |

**When to use:** Task B cannot start until task A is complete. The engine automatically detects cycles and rejects them.

#### `task_ready`

List tasks that are ready to work on — all blocking dependencies are resolved (closed).

| Parameter    | Type   | Required | Description          |
|-------------|--------|----------|----------------------|
| `collection` | string | no       | Filter by collection |
| `priority`   | string | no       | Filter by priority   |

**When to use:** Before starting work, check what's ready. Returns open tasks whose blockers are all closed (or that have no blockers).

#### `task_show`

Get full details of a single task.

| Parameter | Type   | Required | Description        |
|----------|--------|----------|--------------------|
| `taskId`  | string | yes      | ID of the task     |

**Returns:** Task data, tags, subtasks, dependencies, status history, and notes — everything needed to understand the full context.

#### `task_list`

List tasks with optional filters.

| Parameter    | Type   | Required | Description              |
|-------------|--------|----------|--------------------------|
| `status`     | string | no       | Filter by status         |
| `priority`   | string | no       | Filter by priority       |
| `assignee`   | string | no       | Filter by assignee       |
| `type`       | string | no       | Filter by task type      |
| `collection` | string | no       | Filter by collection     |
| `limit`      | number | no       | Maximum results          |

#### `task_add_note`

Add a note to a task.

| Parameter | Type   | Required | Description      |
|----------|--------|----------|------------------|
| `taskId`  | string | yes      | ID of the task   |
| `content` | string | yes      | Note content     |

**When to use:** Record progress, blockers, decisions, or any context during task work.

## Available resources (5)

Resources provide read-only access to data via `memory://` URIs.

| URI                      | Description                                |
|-------------------------|--------------------------------------------|
| `memory://facts`         | List all facts                             |
| `memory://facts/{id}`    | A single fact by record ID                 |
| `memory://tasks`         | List all tasks                             |
| `memory://tasks/ready`   | List tasks ready to work on (unblocked)    |
| `memory://tasks/{id}`    | Full detail of a single task by record ID  |

## Available prompts (2)

Prompts provide reusable templates that inject context or structure.

### `context`

Inject relevant memories for the current conversation.

| Argument | Type   | Required | Description                        |
|---------|--------|----------|------------------------------------|
| `topic`  | string | no       | Focus topic for memory retrieval   |

Returns a list of the user's facts formatted as `- [category] content`. Use at the start of a conversation to ground yourself in what you know about the user.

### `plan`

Task decomposition template for dependency-aware planning.

| Argument | Type   | Required | Description                      |
|---------|--------|----------|----------------------------------|
| `goal`   | string | yes      | The goal to decompose into tasks |

Returns a structured prompt asking you to break a goal into tasks with titles, priorities, types, and dependencies. Follow up by calling `task_create` and `task_add_dependency` to build the graph.

## Workflows

### Task graph workflow

1. **Create an epic:** `task_create` with type `epic` to represent a large goal.
2. **Decompose:** Create subtasks with `parentTaskId` pointing to the epic, or use the `plan` prompt to help structure the decomposition.
3. **Add dependencies:** Use `task_add_dependency` to link tasks that must happen in order. The engine prevents cycles.
4. **Find next work:** Call `task_ready` to find tasks whose blockers are all resolved.
5. **Claim and work:** Use `task_update` with `claim: true` to start work on a ready task.
6. **Annotate progress:** Use `task_add_note` to record decisions, blockers, or progress.
7. **Complete:** Update status to `closed` when done. This may unblock downstream tasks.

### Memory best practices

**What to store as facts:**
- Biographical information (name, location, job, interests)
- Technical environment (languages, tools, frameworks, OS)
- Project context (codebases, team members, deadlines)
- Learned corrections ("User prefers X over Y")

**What to store as preferences:**
- Communication style ("Be concise", "Use bullet points")
- Coding conventions ("Always use strict TypeScript", "Prefer functional style")
- Output format ("Return JSON", "Use markdown tables")
- Accessibility needs

**Categories for facts:** `personal`, `work`, `technical`, `health`, `project`, `general` — or define your own.

**Domains for preferences:** `coding`, `communication`, `ui`, `accessibility`, `workflow` — or define your own.

**Collections:** Use collections to group related memories (e.g. a project name, a topic area). Both facts and tasks support collection tags.

### How to use `memory_search` effectively

- **Semantic search:** Use natural language queries like `"what programming languages does the user know"` — the vector search finds semantically similar content even without exact keyword matches.
- **Keyword search:** Use specific terms like `"TypeScript"` — the FTS5 index handles exact keyword matching with BM25 ranking.
- **Combined:** The hybrid search merges both approaches. Use `category` or `collection` filters to narrow scope.
- **Browse:** Omit `query` to list facts, optionally filtered by `category` or `collection`.

### How to use `task_ready` to find the next work item

1. Call `task_ready` (optionally filter by `collection` or `priority`).
2. Pick the highest-priority task from the results.
3. Call `task_show` on it to get full context (subtasks, deps, notes).
4. Claim it with `task_update` using `claim: true`.
5. After finishing, set status to `closed` and check `task_ready` again — completing a blocker may have unblocked new tasks.

## Best practices

- **Always search before adding a fact.** Call `memory_search` first to check if the information already exists. Avoid duplicates.
- **Use supersession for corrections.** When a fact changes, call `memory_supersede` rather than adding a new fact. This preserves history and marks the old fact as superseded.
- **Use collections to organize.** Group related memories and tasks into collections (e.g. project names) for easier filtering and retrieval.
- **Use task dependencies to model workflows.** Express ordering constraints with `task_add_dependency` — the graph engine handles readiness calculation and cycle detection for you.
- **Check `task_ready` before starting work.** This ensures you pick tasks whose prerequisites are met.
- **Add notes during work.** Use `task_add_note` to record progress, decisions, and blockers. This context is available to future agents via `task_show`.
- **Use the `context` prompt at conversation start.** Inject the user's memories to personalize your responses from the beginning.
- **Use the `plan` prompt for complex goals.** Let the structured decomposition template guide you through breaking a goal into a dependency-aware task graph.
