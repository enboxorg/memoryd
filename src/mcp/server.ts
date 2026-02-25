// memoryd MCP server — wraps @modelcontextprotocol/sdk with Bun HTTP transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export type MemorydServerOptions = {
  port?: number;
  version?: string;
};

/**
 * MCP server for memoryd.
 *
 * Wraps {@link McpServer} and exposes two transport modes:
 *
 * - **stdio** — for CLI / pipe integration (most MCP clients use this).
 * - **HTTP**  — daemon mode via `Bun.serve()` using the Web-Standard
 *   Streamable HTTP transport from the MCP SDK.
 */
export class MemorydServer {
  readonly mcp: McpServer;

  private httpServer: ReturnType<typeof Bun.serve> | undefined;
  private transport: WebStandardStreamableHTTPServerTransport | undefined;

  private readonly port: number;
  private readonly version: string;

  constructor(opts?: MemorydServerOptions) {
    this.port = opts?.port ?? 3200;
    this.version = opts?.version ?? '0.0.1';

    this.mcp = new McpServer(
      { name: 'memoryd', version: this.version },
      {
        capabilities: {
          tools     : {},
          resources : { subscribe: true },
          prompts   : {},
          logging   : {},
        },
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Stdio transport (CLI / pipe mode)
  // ---------------------------------------------------------------------------

  async startStdio(): Promise<void> {
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
  }

  // ---------------------------------------------------------------------------
  // HTTP transport (daemon mode)
  // ---------------------------------------------------------------------------

  async startHttp(): Promise<{ port: number }> {
    const { WebStandardStreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
    );

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: (): string => crypto.randomUUID(),
    });

    this.transport = transport;
    await this.mcp.connect(transport);

    const version = this.version;

    this.httpServer = Bun.serve({
      port: this.port,
      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          return Response.json({
            status  : 'ok',
            name    : 'memoryd',
            version : version,
          });
        }

        if (url.pathname === '/mcp') {
          return transport.handleRequest(req);
        }

        return new Response('Not Found', { status: 404 });
      },
    });

    return { port: this.httpServer.port ?? this.port };
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async stop(): Promise<void> {
    this.httpServer?.stop();
    await this.mcp.close();
    this.httpServer = undefined;
    this.transport = undefined;
  }
}
