import { describe, expect, it } from 'bun:test';

import { AuditProtocol } from '../../src/protocols/audit.js';

const def = AuditProtocol.definition;

describe('AuditProtocol', () => {
  it('has the correct protocol URI', () => {
    expect(def.protocol).toBe('https://enbox.org/protocols/memory-audit/v1');
  });

  it('is not published', () => {
    expect(def.published).toBe(false);
  });

  it('declares all expected types', () => {
    expect(Object.keys(def.types)).toEqual(
      expect.arrayContaining(['actionLog', 'agent']),
    );
  });

  it('marks actionLog as $immutable', () => {
    expect(def.structure.actionLog.$immutable).toBe(true);
  });

  it('requires all five tags on actionLog', () => {
    const tags = def.structure.actionLog.$tags;
    expect(tags?.$requiredTags).toEqual([
      'agentDid',
      'action',
      'targetProtocol',
      'targetRecordId',
      'status',
    ]);
  });

  it('constrains status tag to success | failed', () => {
    const status = def.structure.actionLog.$tags?.status;
    expect(status).toBeDefined();
    expect((status as { enum: string[] }).enum).toEqual(['success', 'failed']);
  });

  it('defines agent as a $role record', () => {
    const agent = def.structure.actionLog.agent;
    expect(agent).toBeDefined();
    expect((agent as { $role: boolean }).$role).toBe(true);
  });

  it('allows actionLog/agent role to create and read', () => {
    const actions = def.structure.actionLog.$actions;
    expect(actions).toBeDefined();
    const roleAction = actions?.find(
      (a) => 'role' in a && a.role === 'actionLog/agent',
    );
    expect(roleAction).toBeDefined();
    expect(roleAction!.can).toEqual(['create', 'read']);
  });

  it('allows author of actionLog to create and read', () => {
    const actions = def.structure.actionLog.$actions;
    expect(actions).toBeDefined();
    const authorAction = actions?.find(
      (a) => 'who' in a && a.who === 'author' && 'of' in a && a.of === 'actionLog',
    );
    expect(authorAction).toBeDefined();
    expect(authorAction!.can).toEqual(['create', 'read']);
  });
});
