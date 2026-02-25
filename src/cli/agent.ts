/**
 * Agent bootstrapping — connects to (or creates) a local Web5 agent.
 *
 * On first run the agent vault is initialized with a password, a DID is
 * created, and the memory protocols are installed.  Subsequent runs unlock
 * the existing vault and return a ready-to-use context with stores.
 *
 * Agent data is stored under the resolved profile path:
 *   `~/.enbox/profiles/<profile>/DATA/AGENT/`
 *
 * @module
 */

import type { CompactionEngine } from '../core/compaction.js';
import type { ConsentManager } from '../core/consent.js';
import type { EmbeddingProvider } from '../sidecar/embeddings.js';
import type { GraphEngine } from '../core/graph.js';
import type { MemorydConfig } from '../config.js';
import type { MemoryStore } from '../core/memory-store.js';
import type { SearchIndex } from '../sidecar/search.js';
import type { SidecarDatabase } from '../sidecar/database.js';
import type { TaskStore } from '../core/task-store.js';
import type { Web5 } from '@enbox/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for connecting to the agent. */
export type ConnectOptions = {
  /** Vault password. */
  password : string;
  /**
   * Agent data path.  When provided, the agent stores all data under
   * this directory instead of the default `DATA/AGENT` relative to CWD.
   *
   * The profile system sets this to `~/.enbox/profiles/<name>/DATA/AGENT`.
   */
  dataPath? : string;
  /**
   * Optional recovery phrase (12-word BIP-39 mnemonic) for initializing
   * a new vault.  When omitted, a new phrase is generated automatically.
   */
  recoveryPhrase? : string;
  /**
   * When true, skip sidecar/search index creation (for commands that
   * don't need search, like `fact add` or `whoami`).
   */
  skipSidecar? : boolean;
  /**
   * Runtime config — when omitted, defaults are resolved from env vars.
   */
  config? : MemorydConfig;
};

/**
 * Loose audit-typed interface — matches the shape expected by
 * `registerMemoryTools()` and `registerTaskTools()` without importing
 * full protocol generics.
 */
export type AuditTyped = {
  configure: () => Promise<unknown>;
  records: {
    create: (type: string, opts: {
      data : Record<string, unknown>;
      tags : Record<string, string>;
    }) => Promise<unknown>;
  };
};

/** Context returned by `connectAgent()` — provides stores and engines. */
export type AgentContext = {
  did : string;
  web5 : Web5;
  memoryStore : MemoryStore;
  taskStore : TaskStore;
  graphEngine : GraphEngine;
  auditTyped? : AuditTyped;
  consentManager? : ConsentManager;
  sidecarDb? : SidecarDatabase;
  searchIndex? : SearchIndex;
  embeddings? : EmbeddingProvider;
  compaction? : CompactionEngine;
  recoveryPhrase? : string;
};

// ---------------------------------------------------------------------------
// Agent bootstrap
// ---------------------------------------------------------------------------

/**
 * Connect to the local Web5 agent, initializing on first launch.
 *
 * When `dataPath` is provided, the agent's persistent data lives there.
 * Otherwise, it falls back to `DATA/AGENT` relative to CWD (legacy).
 *
 * Sync is disabled — the CLI operates against the local DWN only.
 */
export async function connectAgent(options: ConnectOptions): Promise<AgentContext> {
  const { password, dataPath, recoveryPhrase: inputPhrase } = options;

  let web5: Web5;
  let did: string;
  let recoveryPhrase: string | undefined;

  if (dataPath) {
    // Profile-based: create agent with explicit data path.
    const { Web5UserAgent } = await import('@enbox/agent');
    const agent = await Web5UserAgent.create({ dataPath });

    if (await agent.firstLaunch()) {
      recoveryPhrase = await agent.initialize({
        password,
        recoveryPhrase : inputPhrase,
        dwnEndpoints   : ['https://enbox-dwn.fly.dev'],
      });
    }
    await agent.start({ password });

    // Ensure at least one identity exists.
    const identities = await agent.identity.list();
    let identity = identities[0];
    if (!identity) {
      identity = await agent.identity.create({
        didMethod  : 'dht',
        metadata   : { name: 'Default' },
        didOptions : {
          services: [{
            id              : 'dwn',
            type            : 'DecentralizedWebNode',
            serviceEndpoint : ['https://enbox-dwn.fly.dev'],
            enc             : '#enc',
            sig             : '#sig',
          }],
          verificationMethods: [
            { algorithm: 'Ed25519', id: 'sig', purposes: ['assertionMethod', 'authentication'] },
            { algorithm: 'X25519', id: 'enc', purposes: ['keyAgreement'] },
          ],
        },
      });
    }

    const { Web5: Web5Cls } = await import('@enbox/api');
    const result = await Web5Cls.connect({
      agent,
      connectedDid : identity.did.uri,
      sync         : 'off',
    });

    web5 = result.web5;
    did = result.did;
  } else {
    // Legacy: let Web5.connect() manage the agent (uses CWD-relative path).
    const { Web5: Web5Cls } = await import('@enbox/api');
    const result = await Web5Cls.connect({ password, sync: 'off' });

    web5 = result.web5;
    did = result.did;
    recoveryPhrase = result.recoveryPhrase;

    if (recoveryPhrase) {
      console.log('');
      console.log('  Recovery phrase (save this — it cannot be shown again):');
      console.log(`  ${recoveryPhrase}`);
      console.log('');
    }
  }

  // Import dynamically to avoid importing heavy modules at parse time.
  const { MemoryStore: MS } = await import('../core/memory-store.js');
  const { TaskStore: TS } = await import('../core/task-store.js');
  const { GraphEngine: GE } = await import('../core/graph.js');
  const { AuditProtocol } = await import('../protocols/audit.js');
  const { ConsentManager: CM } = await import('../core/consent.js');

  const memoryStore = new MS(web5);
  const taskStore = new TS(web5);
  const graphEngine = new GE(taskStore);
  const auditTyped = web5.using(AuditProtocol) as unknown as AuditTyped;
  const consentManager = new CM(web5);

  // Build the base context.
  const ctx: AgentContext = {
    did, web5, memoryStore, taskStore, graphEngine,
    auditTyped, consentManager, recoveryPhrase,
  };

  // Optionally bootstrap the sidecar search index.
  if (!options.skipSidecar) {
    await bootstrapSidecar(ctx, options.config);
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Sidecar bootstrap
// ---------------------------------------------------------------------------

/**
 * Create the sidecar database, embedding provider, search index, and
 * compaction engine.  Mutates the given {@link AgentContext} in place.
 */
export async function bootstrapSidecar(
  ctx: AgentContext,
  config?: MemorydConfig,
): Promise<void> {
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const { resolveConfig } = await import('../config.js');
  const { SidecarDatabase: SDB } = await import('../sidecar/database.js');
  const { SearchIndex: SI } = await import('../sidecar/search.js');
  const { createEmbeddingProvider } = await import('../sidecar/embeddings.js');
  const { CompactionEngine: CE } = await import('../core/compaction.js');

  const cfg = config ?? resolveConfig();
  const provider = createEmbeddingProvider(cfg.embedding);

  // Ensure parent directory exists.
  mkdirSync(dirname(cfg.sidecarPath), { recursive: true });

  const sidecarDb = new SDB(cfg.sidecarPath, provider.dimensions);
  const searchIndex = new SI(sidecarDb.db, provider);
  const compaction = new CE(ctx.memoryStore, ctx.taskStore, {
    sidecarDb: sidecarDb.db,
    searchIndex,
  });

  ctx.sidecarDb = sidecarDb;
  ctx.searchIndex = searchIndex;
  ctx.embeddings = provider;
  ctx.compaction = compaction;
}
