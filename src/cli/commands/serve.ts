// memoryd CLI — serve command: start the MCP HTTP/SSE server.

import type { AgentContext } from '../agent.js';

import { flagValue, parsePort } from '../flags.js';

export async function serveCommand(ctx: AgentContext, args: string[]): Promise<void> {
  const { MemorydServer } = await import('../../mcp/server.js');
  const { registerMemoryTools } = await import('../../mcp/tools/memory-tools.js');
  const { registerTaskTools } = await import('../../mcp/tools/task-tools.js');

  const port = parsePort(flagValue(args, '--port'), 3200);
  const server = new MemorydServer({ port });

  registerMemoryTools(server, ctx.memoryStore);
  registerTaskTools(server, ctx.taskStore, ctx.graphEngine);

  const { port: actualPort } = await server.startHttp();
  console.log(`memoryd MCP server listening on http://localhost:${actualPort}`);
  console.log(`DID: ${ctx.did}`);
  console.log('Press Ctrl+C to stop.');
}
