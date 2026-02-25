// memoryd CLI — bootstrap Web5 agent and return an AgentContext.

import type { GraphEngine } from '../core/graph.js';
import type { MemoryStore } from '../core/memory-store.js';
import type { SearchIndex } from '../sidecar/search.js';
import type { SidecarDatabase } from '../sidecar/database.js';
import type { TaskStore } from '../core/task-store.js';
import type { Web5 } from '@enbox/api';

export type AgentContext = {
  did: string;
  web5: Web5;
  memoryStore: MemoryStore;
  taskStore: TaskStore;
  graphEngine: GraphEngine;
  sidecarDb?: SidecarDatabase;
  searchIndex?: SearchIndex;
};

export async function connectAgent(password: string): Promise<AgentContext> {
  const { Web5: Web5Cls } = await import('@enbox/api');
  const { web5, did, recoveryPhrase } = await Web5Cls.connect({ password, sync: 'off' });

  if (recoveryPhrase) {
    console.log('');
    console.log('=== RECOVERY PHRASE (save this!) ===');
    console.log(recoveryPhrase);
    console.log('===================================');
    console.log('');
  }

  // Import dynamically to avoid importing heavy modules at parse time
  const { MemoryStore: MS } = await import('../core/memory-store.js');
  const { TaskStore: TS } = await import('../core/task-store.js');
  const { GraphEngine: GE } = await import('../core/graph.js');

  const memoryStore = new MS(web5);
  const taskStore = new TS(web5);
  const graphEngine = new GE(taskStore);

  return { did, web5, memoryStore, taskStore, graphEngine };
}
