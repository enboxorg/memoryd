// memoryd CLI — revoke command: revoke agent consent.

import type { AgentContext } from '../agent.js';

export async function revokeCommand(ctx: AgentContext, args: string[]): Promise<void> {
  const agentDid = args.find(a => !a.startsWith('--'));
  if (!agentDid) {
    console.error('Usage: memoryd revoke <agent-did>');
    process.exit(1);
  }

  const { ConsentManager } = await import('../../core/consent.js');
  const manager = new ConsentManager(ctx.web5);
  const revoked = await manager.revokeAgent(agentDid);

  if (revoked) {
    console.log(`Agent ${agentDid} revoked successfully.`);
  } else {
    console.log(`No agent found with DID: ${agentDid}`);
  }
}
