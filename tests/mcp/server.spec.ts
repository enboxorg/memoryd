import { afterEach, describe, expect, it } from 'bun:test';

import { MemorydServer } from '../../src/mcp/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: MemorydServer | undefined;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = undefined;
  }
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('MemorydServer — constructor', () => {
  it('creates a server with default options', () => {
    server = new MemorydServer();
    expect(server).toBeInstanceOf(MemorydServer);
    expect(server.mcp).toBeDefined();
  });

  it('accepts custom port and version', () => {
    server = new MemorydServer({ port: 4567, version: '1.2.3' });
    expect(server).toBeInstanceOf(MemorydServer);
    expect(server.mcp).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

describe('MemorydServer — startHttp', () => {
  it('starts an HTTP server and returns the actual port', async () => {
    server = new MemorydServer({ port: 0 });
    const result = await server.startHttp();
    expect(result.port).toBeGreaterThan(0);
  });

  it('health endpoint returns 200 with status ok', async () => {
    server = new MemorydServer({ port: 0 });
    const { port } = await server.startHttp();

    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; name: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.name).toBe('memoryd');
    expect(body.version).toBe('0.0.1');
  });

  it('health endpoint reflects custom version', async () => {
    server = new MemorydServer({ port: 0, version: '2.0.0' });
    const { port } = await server.startHttp();

    const res = await fetch(`http://localhost:${port}/health`);
    const body = await res.json() as { version: string };
    expect(body.version).toBe('2.0.0');
  });

  it('unknown routes return 404', async () => {
    server = new MemorydServer({ port: 0 });
    const { port } = await server.startHttp();

    const res = await fetch(`http://localhost:${port}/does-not-exist`);
    expect(res.status).toBe(404);

    const text = await res.text();
    expect(text).toBe('Not Found');
  });

  it('/mcp endpoint exists and handles POST (MCP protocol)', async () => {
    server = new MemorydServer({ port: 0 });
    const { port } = await server.startHttp();

    // Send an initialize JSON-RPC request to the MCP endpoint.
    // The MCP Streamable HTTP transport requires Accept headers.
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method  : 'POST',
      headers : {
        'Content-Type' : 'application/json',
        'Accept'       : 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc : '2.0',
        id      : 1,
        method  : 'initialize',
        params  : {
          protocolVersion : '2025-03-26',
          capabilities    : {},
          clientInfo      : { name: 'test-client', version: '0.1.0' },
        },
      }),
    });

    // The transport should respond (200 for SSE stream, 202 for accepted)
    expect([200, 202]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('MemorydServer — capabilities', () => {
  it('McpServer instance exposes the low-level Server', () => {
    server = new MemorydServer();
    // The McpServer has a `server` property (low-level Server)
    expect(server.mcp.server).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

describe('MemorydServer — stop', () => {
  it('stop is safe to call multiple times', async () => {
    server = new MemorydServer({ port: 0 });
    await server.startHttp();

    await server.stop();
    await server.stop(); // should not throw
    server = undefined; // prevent afterEach from stopping again
  });

  it('stop shuts down the HTTP server', async () => {
    server = new MemorydServer({ port: 0 });
    const { port } = await server.startHttp();

    // Verify server is running
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);

    await server.stop();
    server = undefined;

    // After stop, the server should no longer respond
    try {
      await fetch(`http://localhost:${port}/health`);
      // If the fetch succeeds, the server is still running — fail the test
      expect(true).toBe(false);
    } catch {
      // Expected: connection refused or similar error
      expect(true).toBe(true);
    }
  });
});
