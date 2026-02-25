import { rmSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { GraphEngine } from '../../../src/core/graph.js';
import { MemorydServer } from '../../../src/mcp/server.js';
import { MemoryStore } from '../../../src/core/memory-store.js';
import { registerMemoryResources } from '../../../src/mcp/resources/memory-resources.js';
import { registerTaskResources } from '../../../src/mcp/resources/task-resources.js';
import { TaskStore } from '../../../src/core/task-store.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const DATA_PATH = '__TESTDATA__/resources';

let server: MemorydServer;
let client: Client;
let memoryStore: MemoryStore;
let taskStore: TaskStore;
let port: number;

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
          { algorithm: 'Ed25519', purposes: ['authentication', 'assertionMethod'] },
          { algorithm: 'X25519', purposes: ['keyAgreement'] },
        ],
      },
    });
  }

  const result = await Web5.connect({
    agent,
    connectedDid : identity.did.uri,
    sync         : 'off',
  });

  memoryStore = new MemoryStore(result.web5);
  taskStore = new TaskStore(result.web5);
  const graphEngine = new GraphEngine(taskStore);

  server = new MemorydServer({ port: 0 });
  registerMemoryResources(server, memoryStore);
  registerTaskResources(server, taskStore, graphEngine);
  const httpResult = await server.startHttp();
  port = httpResult.port;

  client = new Client({ name: 'test-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${port}/mcp`),
  );
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
  rmSync(DATA_PATH, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Resource listing
// ---------------------------------------------------------------------------

describe('MCP resources — listing', () => {
  it('lists registered resources', async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);

    expect(uris).toContain('memory://facts');
    expect(uris).toContain('memory://tasks');
    expect(uris).toContain('memory://tasks/ready');
  }, 30_000);

  it('lists registered resource templates', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const uriTemplates = resourceTemplates.map((t) => t.uriTemplate);

    expect(uriTemplates).toContain('memory://facts/{id}');
    expect(uriTemplates).toContain('memory://tasks/{id}');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Memory resources
// ---------------------------------------------------------------------------

describe('MCP resources — memory://facts', () => {
  it('returns empty list initially', async () => {
    const result = await client.readResource({ uri: 'memory://facts' });
    const parsed = JSON.parse(result.contents[0].text as string);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);
  }, 30_000);

  it('returns a fact after adding one via store', async () => {
    const addResult = await memoryStore.addFact(
      'TypeScript is great', 'technical', 'user',
    );

    const result = await client.readResource({
      uri: `memory://facts/${addResult.id}`,
    });
    const parsed = JSON.parse(result.contents[0].text as string);

    expect(parsed.id).toBe(addResult.id);
    expect(parsed.data.content).toBe('TypeScript is great');
    expect(parsed.tags.category).toBe('technical');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Task resources
// ---------------------------------------------------------------------------

describe('MCP resources — memory://tasks', () => {
  it('returns empty list initially', async () => {
    const result = await client.readResource({ uri: 'memory://tasks' });
    const parsed = JSON.parse(result.contents[0].text as string);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);
  }, 30_000);

  it('returns empty ready tasks initially', async () => {
    const result = await client.readResource({ uri: 'memory://tasks/ready' });
    const parsed = JSON.parse(result.contents[0].text as string);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);
  }, 30_000);
});
