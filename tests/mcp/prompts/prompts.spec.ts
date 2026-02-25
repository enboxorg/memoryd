import { rmSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { MemorydServer } from '../../../src/mcp/server.js';
import { MemoryStore } from '../../../src/core/memory-store.js';
import { registerContextPrompt } from '../../../src/mcp/prompts/context-prompt.js';
import { registerPlanPrompt } from '../../../src/mcp/prompts/plan-prompt.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const DATA_PATH = '__TESTDATA__/prompts';

let server: MemorydServer;
let client: Client;
let memoryStore: MemoryStore;
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

  server = new MemorydServer({ port: 0 });
  registerContextPrompt(server, memoryStore);
  registerPlanPrompt(server);
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
// Prompt listing
// ---------------------------------------------------------------------------

describe('MCP prompts — listing', () => {
  it('lists context and plan prompts', async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);

    expect(names).toContain('context');
    expect(names).toContain('plan');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// context prompt
// ---------------------------------------------------------------------------

describe('MCP prompts — context', () => {
  it('returns "No memories" message when no facts exist', async () => {
    const result = await client.getPrompt({ name: 'context', arguments: {} });

    expect(result.messages.length).toBe(1);
    expect(result.messages[0].role).toBe('user');

    const text = (result.messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('No memories found');
  }, 30_000);

  it('returns memories after adding facts', async () => {
    await memoryStore.addFact('User likes Bun runtime', 'technical', 'agent');
    await memoryStore.addFact('User prefers dark mode', 'technical', 'user');

    const result = await client.getPrompt({
      name      : 'context',
      arguments : { topic: 'technical' },
    });

    expect(result.messages.length).toBe(1);
    const text = (result.messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('relevant memories');
    expect(text).toContain('Bun runtime');
    expect(text).toContain('dark mode');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// plan prompt
// ---------------------------------------------------------------------------

describe('MCP prompts — plan', () => {
  it('returns decomposition template with the goal', async () => {
    const result = await client.getPrompt({
      name      : 'plan',
      arguments : { goal: 'Build a REST API' },
    });

    expect(result.messages.length).toBe(1);
    expect(result.messages[0].role).toBe('user');

    const text = (result.messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('Build a REST API');
    expect(text).toContain('dependency-aware task graph');
    expect(text).toContain('task_create');
  }, 30_000);
});
