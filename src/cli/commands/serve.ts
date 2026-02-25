// memoryd CLI — serve command: start the MCP server (HTTP or stdio).

import type { AgentContext } from '../agent.js';

import { resolveConfig } from '../../config.js';
import { flagValue, hasFlag, parsePort } from '../flags.js';

export async function serveCommand(ctx: AgentContext, args: string[]): Promise<void> {
  const { MemorydServer } = await import('../../mcp/server.js');
  const { registerMemoryTools } = await import('../../mcp/tools/memory-tools.js');
  const { registerTaskTools } = await import('../../mcp/tools/task-tools.js');
  const { registerMemoryResources } = await import('../../mcp/resources/memory-resources.js');
  const { registerTaskResources } = await import('../../mcp/resources/task-resources.js');
  const { registerContextPrompt } = await import('../../mcp/prompts/context-prompt.js');
  const { registerPlanPrompt } = await import('../../mcp/prompts/plan-prompt.js');

  const useStdio = hasFlag(args, '--stdio');
  const port = parsePort(flagValue(args, '--port'), 3200);
  const server = new MemorydServer({ port });

  // Configure audit protocol so action logs can be written during serve.
  if (ctx.auditTyped) {
    await ctx.auditTyped.configure();
  }

  // Register all tools, resources, and prompts.
  registerMemoryTools(server, ctx.memoryStore, ctx.searchIndex, ctx.auditTyped, ctx.compaction);
  registerTaskTools(server, ctx.taskStore, ctx.graphEngine, ctx.auditTyped);
  registerMemoryResources(server, ctx.memoryStore);
  registerTaskResources(server, ctx.taskStore, ctx.graphEngine);
  registerContextPrompt(server, ctx.memoryStore);
  registerPlanPrompt(server);

  // Graceful shutdown.
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    await server.stop();
    ctx.sidecarDb?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  if (useStdio) {
    await server.startStdio();
    printNoopWarning();
    // stdio transport blocks until the client disconnects.
  } else {
    const { port: actualPort } = await server.startHttp();
    console.log(`memoryd MCP server listening on http://localhost:${actualPort}`);
    console.log(`DID: ${ctx.did}`);
    console.log('Press Ctrl+C to stop.');
    printNoopWarning();
  }
}

/** Print a warning when the noop embedding provider is active. */
function printNoopWarning(): void {
  const cfg = resolveConfig();
  if (cfg.embedding.provider === 'noop') {
    console.log('');
    console.log('Warning: Using noop embedding provider — semantic search is disabled.');
    console.log('  Set MEMORYD_EMBEDDING_PROVIDER=ollama or =openai for full hybrid search.');
  }
}
