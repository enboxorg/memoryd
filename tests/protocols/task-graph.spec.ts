import { describe, expect, it } from 'bun:test';

import { TaskGraphProtocol } from '../../src/protocols/task-graph.js';

const def = TaskGraphProtocol.definition;

describe('TaskGraphProtocol', () => {
  it('has the correct protocol URI', () => {
    expect(def.protocol).toBe('https://enbox.org/protocols/task-graph/v1');
  });

  it('is not published', () => {
    expect(def.published).toBe(false);
  });

  it('defines all expected types', () => {
    const typeNames = Object.keys(def.types);
    expect(typeNames).toContain('task');
    expect(typeNames).toContain('dependency');
    expect(typeNames).toContain('statusChange');
    expect(typeNames).toContain('note');
    expect(typeNames).toContain('agent');
  });

  it('task type has encryptionRequired: true', () => {
    expect(def.types.task.encryptionRequired).toBe(true);
  });

  it('task structure has required tags (status, priority)', () => {
    const taskRule = def.structure.task;
    expect(taskRule.$tags).toBeDefined();
    const tags = taskRule.$tags!;
    expect(tags.$requiredTags).toContain('status');
    expect(tags.$requiredTags).toContain('priority');
  });

  it('task status tag has correct enum values', () => {
    const tags = def.structure.task.$tags!;
    const statusTag = tags.status as { type: string; enum: string[] };
    expect(statusTag.enum).toEqual(['open', 'in_progress', 'blocked', 'closed']);
  });

  it('task priority tag has correct enum values', () => {
    const tags = def.structure.task.$tags!;
    const priorityTag = tags.priority as { type: string; enum: string[] };
    expect(priorityTag.enum).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('dependency is $immutable', () => {
    const depRule = def.structure.task.dependency as { $immutable?: boolean };
    expect(depRule.$immutable).toBe(true);
  });

  it('statusChange is $immutable', () => {
    const scRule = def.structure.task.statusChange as { $immutable?: boolean };
    expect(scRule.$immutable).toBe(true);
  });

  it('dependency has required tags (type, targetId)', () => {
    const depRule = def.structure.task.dependency as { $tags?: { $requiredTags?: string[] } };
    expect(depRule.$tags).toBeDefined();
    expect(depRule.$tags!.$requiredTags).toContain('type');
    expect(depRule.$tags!.$requiredTags).toContain('targetId');
  });

  it('statusChange has required tags (from, to)', () => {
    const scRule = def.structure.task.statusChange as { $tags?: { $requiredTags?: string[] } };
    expect(scRule.$tags).toBeDefined();
    expect(scRule.$tags!.$requiredTags).toContain('from');
    expect(scRule.$tags!.$requiredTags).toContain('to');
  });

  it('supports recursive task nesting (task > task > task)', () => {
    const level1 = def.structure.task;
    expect(level1.task).toBeDefined();

    const level2 = level1.task as typeof level1;
    expect(level2.task).toBeDefined();

    const level3 = level2.task as typeof level1;
    expect(level3.$tags).toBeDefined();
    expect(level3.$actions).toBeDefined();
  });

  it('agent role record exists with $role: true', () => {
    const agentRule = def.structure.task.agent as { $role?: boolean };
    expect(agentRule.$role).toBe(true);
  });

  it('note structure exists under task', () => {
    const noteRule = def.structure.task.note as { $actions?: unknown[] };
    expect(noteRule).toBeDefined();
    expect(noteRule.$actions).toBeDefined();
  });
});
