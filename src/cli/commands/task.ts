// memoryd CLI — task command: create, list, ready, show, update, dep, note.

import type { AgentContext } from '../agent.js';

import { flagValue, hasFlag } from '../flags.js';

/**
 * Collect positional arguments (those not starting with '--' and not a value
 * following a flag).  Returns all non-flag tokens in order.
 */
function positionalArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip flag value
      continue;
    }
    result.push(args[i]);
  }
  return result;
}

export async function taskCommand(ctx: AgentContext, args: string[], json: boolean): Promise<void> {
  const sub = args[0];
  const subArgs = args.slice(1);

  switch (sub) {
    case 'create': {
      const positional = positionalArgs(subArgs);
      const title = positional[0];
      if (!title) {
        console.error('Usage: memoryd task create <title> [--priority <p>] [--description <d>]');
        process.exit(1);
      }
      const priority = flagValue(subArgs, '--priority') ?? 'p1';
      const description = flagValue(subArgs, '--description');
      const type = flagValue(subArgs, '--type');
      const assignee = flagValue(subArgs, '--assignee');
      const collection = flagValue(subArgs, '--collection');
      const parentTaskId = flagValue(subArgs, '--parent');

      let result;
      if (parentTaskId) {
        const parent = await ctx.taskStore.getTask(parentTaskId);
        result = await ctx.taskStore.createSubtask(parent.contextId!, title, priority, {
          description, type, assignee, collection,
        });
      } else {
        result = await ctx.taskStore.createTask(title, priority, {
          description, type, assignee, collection,
        });
      }

      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Task created: ${result.id}`);
      }
      break;
    }

    case 'list': {
      const status = flagValue(subArgs, '--status');
      const priority = flagValue(subArgs, '--priority');
      const assignee = flagValue(subArgs, '--assignee');
      const type = flagValue(subArgs, '--type');
      const collection = flagValue(subArgs, '--collection');
      const limitStr = flagValue(subArgs, '--limit');

      const filters: Record<string, string> = {};
      if (status !== undefined) { filters.status = status; }
      if (priority !== undefined) { filters.priority = priority; }
      if (assignee !== undefined) { filters.assignee = assignee; }
      if (type !== undefined) { filters.type = type; }
      if (collection !== undefined) { filters.collection = collection; }

      const hasFilters = Object.keys(filters).length > 0;
      const result = await ctx.taskStore.listTasks(
        hasFilters ? filters : undefined,
        limitStr ? { limit: Number(limitStr) } : undefined,
      );

      if (json) {
        console.log(JSON.stringify(result.records, null, 2));
      } else if (result.records.length === 0) {
        console.log('No tasks found.');
      } else {
        for (const t of result.records) {
          const assigneeStr = t.tags.assignee ? ` @${t.tags.assignee}` : '';
          console.log(`[${t.tags.status}] [${t.tags.priority}] ${t.data.title}${assigneeStr} (${t.id})`);
        }
      }
      break;
    }

    case 'ready': {
      const collection = flagValue(subArgs, '--collection');
      const priority = flagValue(subArgs, '--priority');
      const ready = await ctx.graphEngine.getReadyTasks({ collection, priority });

      if (json) {
        console.log(JSON.stringify(ready, null, 2));
      } else if (ready.length === 0) {
        console.log('No ready tasks.');
      } else {
        for (const t of ready) {
          console.log(`[${t.tags.priority}] ${t.data.title} (${t.id})`);
        }
      }
      break;
    }

    case 'show': {
      const positional = positionalArgs(subArgs);
      const taskId = positional[0];
      if (!taskId) {
        console.error('Usage: memoryd task show <id>');
        process.exit(1);
      }
      const detail = await ctx.taskStore.getTask(taskId);

      if (json) {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        console.log(`Task: ${detail.data.title}`);
        console.log(`  ID:       ${detail.id}`);
        console.log(`  Status:   ${detail.tags.status}`);
        console.log(`  Priority: ${detail.tags.priority}`);
        if (detail.data.description) {
          console.log(`  Desc:     ${detail.data.description}`);
        }
        if (detail.tags.assignee) {
          console.log(`  Assignee: ${detail.tags.assignee}`);
        }
        if (detail.subtasks.length > 0) {
          console.log(`  Subtasks (${detail.subtasks.length}):`);
          for (const s of detail.subtasks) {
            console.log(`    [${s.tags.status}] ${s.data.title} (${s.id})`);
          }
        }
        if (detail.dependencies.length > 0) {
          console.log(`  Dependencies (${detail.dependencies.length}):`);
          for (const d of detail.dependencies) {
            console.log(`    ${d.tags.type} → ${d.tags.targetId}`);
          }
        }
        if (detail.notes.length > 0) {
          console.log(`  Notes (${detail.notes.length}):`);
          for (const n of detail.notes) {
            console.log(`    ${n.data.content} (${n.dateCreated})`);
          }
        }
      }
      break;
    }

    case 'update': {
      const positional = positionalArgs(subArgs);
      const taskId = positional[0];
      if (!taskId) {
        console.error('Usage: memoryd task update <id> [--status <s>] [--priority <p>] [--assignee <a>]');
        process.exit(1);
      }

      if (hasFlag(subArgs, '--claim')) {
        const assignee = flagValue(subArgs, '--assignee') ?? 'user';
        const result = await ctx.taskStore.claimTask(taskId, assignee);
        if (json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Task claimed: ${result.id}`);
        }
        break;
      }

      const updates: Record<string, string> = {};
      const status = flagValue(subArgs, '--status');
      const priority = flagValue(subArgs, '--priority');
      const assignee = flagValue(subArgs, '--assignee');
      if (status !== undefined) { updates.status = status; }
      if (priority !== undefined) { updates.priority = priority; }
      if (assignee !== undefined) { updates.assignee = assignee; }

      const result = await ctx.taskStore.updateTask(taskId, updates);
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Task updated: ${result.id}`);
      }
      break;
    }

    case 'dep': {
      const depSub = subArgs[0];
      if (depSub !== 'add') {
        console.error('Usage: memoryd task dep add <child> <parent>');
        process.exit(1);
      }
      const depArgs = subArgs.slice(1);
      const positional = positionalArgs(depArgs);
      const childId = positional[0];
      const parentId = positional[1];
      if (!childId || !parentId) {
        console.error('Usage: memoryd task dep add <child> <parent>');
        process.exit(1);
      }

      const cycle = await ctx.graphEngine.detectCycle(childId, parentId);
      if (cycle) {
        console.error(`Cycle detected: ${cycle.join(' -> ')}`);
        process.exit(1);
      }

      const child = await ctx.taskStore.getTask(childId);
      await ctx.taskStore.addDependency(child.contextId!, parentId, 'blocks');

      if (json) {
        console.log(JSON.stringify({ success: true, childId, parentId, type: 'blocks' }, null, 2));
      } else {
        console.log(`Dependency added: ${childId} is blocked by ${parentId}`);
      }
      break;
    }

    case 'note': {
      const positional = positionalArgs(subArgs);
      const taskId = positional[0];
      const content = positional[1];
      if (!taskId || !content) {
        console.error('Usage: memoryd task note <id> <content>');
        process.exit(1);
      }

      const task = await ctx.taskStore.getTask(taskId);
      await ctx.taskStore.addNote(task.contextId!, content);

      if (json) {
        console.log(JSON.stringify({ success: true, taskId }, null, 2));
      } else {
        console.log(`Note added to task: ${taskId}`);
      }
      break;
    }

    default: {
      console.error(`Unknown task subcommand: ${sub}`);
      console.error('Usage: memoryd task <create|list|ready|show|update|dep|note>');
      process.exit(1);
    }
  }
}
