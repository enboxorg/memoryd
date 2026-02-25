import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { MemorydServer } from '../../../src/mcp/server.js';
import { MemoryProtocol } from '../../../src/protocols/memory.js';
import { MemoryStore } from '../../../src/core/memory-store.js';
import { registerMemoryTools } from '../../../src/mcp/tools/memory-tools.js';

const DATA_PATH = '__TESTDATA__/memory-tools';

describe('memory tools (MCP)', () => {
  let server: MemorydServer;
  let store: MemoryStore;
  let client: Client;
  let port: number;

  beforeAll(async () => {
    rmSync(DATA_PATH, { recursive: true, force: true });

    // ----- DWN agent + identity -----
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

    const { web5 } = await Web5.connect({
      agent,
      connectedDid : identity.did.uri,
      sync         : 'off',
    });

    // Configure protocol
    const typed = web5.using(MemoryProtocol);
    await typed.configure({ encryption: true });

    store = new MemoryStore(web5);

    // ----- MCP server -----
    server = new MemorydServer({ port: 0 });
    registerMemoryTools(server, store);
    const result = await server.startHttp();
    port = result.port;

    // ----- MCP client -----
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

  // -------------------------------------------------------------------------
  // Tool listing
  // -------------------------------------------------------------------------

  it('lists all 5 memory tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('memory_add_fact');
    expect(names).toContain('memory_add_preference');
    expect(names).toContain('memory_search');
    expect(names).toContain('memory_supersede');
    expect(names).toContain('memory_compact');
  });

  // -------------------------------------------------------------------------
  // memory_add_fact
  // -------------------------------------------------------------------------

  it('memory_add_fact creates a fact and returns result with id', async () => {
    const result = await client.callTool({
      name      : 'memory_add_fact',
      arguments : {
        content  : 'User prefers TypeScript',
        category : 'technical',
        source   : 'user',
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(parsed.id).toBeDefined();
    expect(typeof parsed.id).toBe('string');
    expect(parsed.status.code).toBe(202);
  });

  // -------------------------------------------------------------------------
  // memory_add_preference
  // -------------------------------------------------------------------------

  it('memory_add_preference creates a preference', async () => {
    const result = await client.callTool({
      name      : 'memory_add_preference',
      arguments : {
        content : 'Dark mode preferred',
        domain  : 'ui',
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(parsed.id).toBeDefined();
    expect(parsed.status.code).toBe(202);
  });

  // -------------------------------------------------------------------------
  // memory_search — fallback to listFacts
  // -------------------------------------------------------------------------

  it('memory_search without search index falls back to listing facts', async () => {
    // Add a fact first so there's something to find
    await client.callTool({
      name      : 'memory_add_fact',
      arguments : {
        content  : 'Searchable fact about cats',
        category : 'animals',
        source   : 'user',
      },
    });

    const result = await client.callTool({
      name      : 'memory_search',
      arguments : { category: 'animals' },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].data.content).toContain('cats');
  });

  // -------------------------------------------------------------------------
  // memory_supersede
  // -------------------------------------------------------------------------

  it('memory_supersede replaces a fact', async () => {
    // Create initial fact
    const addResult = await client.callTool({
      name      : 'memory_add_fact',
      arguments : {
        content  : 'Old fact to supersede',
        category : 'test-supersede',
        source   : 'user',
      },
    });
    const addParsed = JSON.parse((addResult.content as { type: string; text: string }[])[0].text);
    const oldId = addParsed.id;

    // Supersede it
    const supersedeResult = await client.callTool({
      name      : 'memory_supersede',
      arguments : {
        oldFactId  : oldId,
        newContent : 'New superseding fact',
        reason     : 'Updated information',
      },
    });

    expect(supersedeResult.isError).toBeFalsy();
    const parsed = JSON.parse((supersedeResult.content as { type: string; text: string }[])[0].text);
    expect(parsed.id).toBeDefined();
    expect(parsed.id).not.toBe(oldId);
    expect(parsed.status.code).toBe(202);
  });

  // -------------------------------------------------------------------------
  // memory_compact — not configured (no compaction engine)
  // -------------------------------------------------------------------------

  it('memory_compact returns not-configured when no compaction engine', async () => {
    const result = await client.callTool({
      name      : 'memory_compact',
      arguments : {},
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(parsed.status).toBe('not_configured');
    expect(parsed.message).toContain('not configured');
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('returns error for invalid supersede with non-existent record', async () => {
    const result = await client.callTool({
      name      : 'memory_supersede',
      arguments : {
        oldFactId  : 'non-existent-record-id',
        newContent : 'Should fail',
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text.length).toBeGreaterThan(0);
  });
});
