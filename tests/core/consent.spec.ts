import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { ConsentManager } from '../../src/core/consent.js';
import { MemoryProtocol } from '../../src/protocols/memory.js';

const DATA_PATH = '__TESTDATA__/consent';

describe('ConsentManager', () => {
  let manager: ConsentManager;
  let web5: Web5;

  beforeAll(async () => {
    rmSync(DATA_PATH, { recursive: true, force: true });
    const agent = await Web5UserAgent.create({ dataPath: DATA_PATH });
    await agent.initialize({ password: 'test' });
    await agent.start({ password: 'test' });
    const identities = await agent.identity.list();
    let identity = identities[0];
    if (!identity) {
      identity = await agent.identity.create({
        didMethod  : 'dht',
        metadata   : { name: 'Test' },
        didOptions : {
          verificationMethods: [
            {
              algorithm : 'Ed25519',
              id        : 'sig',
              purposes  : ['assertionMethod', 'authentication'],
            },
            {
              algorithm : 'X25519',
              id        : 'enc',
              purposes  : ['keyAgreement'],
            },
          ],
        },
      });
    }
    const result = await Web5.connect({
      agent,
      connectedDid : identity.did.uri,
      sync         : 'off',
    });
    web5 = result.web5;

    // Configure protocol with encryption
    const typed = web5.using(MemoryProtocol);
    await typed.configure({ encryption: true });

    manager = new ConsentManager(web5);
  }, 30_000);

  afterAll(() => {
    rmSync(DATA_PATH, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // registerAgent
  // -------------------------------------------------------------------------

  it('registerAgent stores agent metadata and returns AgentRecord', async () => {
    const record = await manager.registerAgent('did:dht:agent1', 'TestAgent', {
      description : 'A test agent',
      scopes      : [{ protocol: 'memory/v1', path: 'fact', actions: ['read'] }],
    });

    expect(record.id).toBeDefined();
    expect(typeof record.id).toBe('string');
    expect(record.data.did).toBe('did:dht:agent1');
    expect(record.data.name).toBe('TestAgent');
    expect(record.data.description).toBe('A test agent');
    expect(record.data.scopes).toHaveLength(1);
    expect(record.data.scopes[0].protocol).toBe('memory/v1');
    expect(record.data.grantedAt).toBeDefined();
    expect(record.dateCreated).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // listAgents
  // -------------------------------------------------------------------------

  it('listAgents returns registered agents', async () => {
    const agents = await manager.listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(1);
    const found = agents.find(a => a.data.did === 'did:dht:agent1');
    expect(found).toBeDefined();
    expect(found!.data.name).toBe('TestAgent');
  });

  it('listAgents returns empty when no agents registered', async () => {
    // Create a fresh ConsentManager against same web5 — but first revoke all
    const agents = await manager.listAgents();
    const dids = new Set(agents.map(a => a.data.did));
    for (const did of dids) {
      await manager.revokeAgent(did);
    }
    const result = await manager.listAgents();
    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // revokeAgent
  // -------------------------------------------------------------------------

  it('revokeAgent removes an agent and returns true', async () => {
    // Register a fresh agent
    await manager.registerAgent('did:dht:revokeme', 'RevokeTest');
    const revoked = await manager.revokeAgent('did:dht:revokeme');
    expect(revoked).toBe(true);

    // Verify it's gone
    const agent = await manager.getAgent('did:dht:revokeme');
    expect(agent).toBeUndefined();
  });

  it('revokeAgent returns false for unknown DID', async () => {
    const revoked = await manager.revokeAgent('did:dht:unknown');
    expect(revoked).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Register, revoke, list lifecycle
  // -------------------------------------------------------------------------

  it('register then revoke then list shows agent removed', async () => {
    await manager.registerAgent('did:dht:lifecycle', 'LifecycleAgent', {
      scopes: [
        { protocol: 'memory/v1', path: '*', actions: ['*'] },
        { protocol: 'task-graph/v1', path: 'task', actions: ['create', 'read'] },
      ],
    });

    // Verify it's listed
    let agents = await manager.listAgents();
    expect(agents.find(a => a.data.did === 'did:dht:lifecycle')).toBeDefined();

    // Revoke
    const revoked = await manager.revokeAgent('did:dht:lifecycle');
    expect(revoked).toBe(true);

    // Verify it's gone
    agents = await manager.listAgents();
    expect(agents.find(a => a.data.did === 'did:dht:lifecycle')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // getAgent
  // -------------------------------------------------------------------------

  it('getAgent returns undefined for unknown DID', async () => {
    const agent = await manager.getAgent('did:dht:nonexistent');
    expect(agent).toBeUndefined();
  });

  it('getAgent returns agent record for registered DID', async () => {
    await manager.registerAgent('did:dht:getme', 'GetMeAgent');
    const agent = await manager.getAgent('did:dht:getme');
    expect(agent).toBeDefined();
    expect(agent!.data.did).toBe('did:dht:getme');
    expect(agent!.data.name).toBe('GetMeAgent');
  });

  // -------------------------------------------------------------------------
  // getAgentAuditLog
  // -------------------------------------------------------------------------

  it('getAgentAuditLog returns empty for unknown agent', async () => {
    const logs = await manager.getAgentAuditLog('did:dht:nologs');
    expect(logs).toHaveLength(0);
  });
});
