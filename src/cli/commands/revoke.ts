// memoryd CLI — revoke command: revoke agent consent.

import type { AgentContext } from '../agent.js';

export async function revokeCommand(ctx: AgentContext, args: string[]): Promise<void> {
  const agentDid = args.find(a => !a.startsWith('--'));
  if (!agentDid) {
    console.error('Usage: memoryd revoke <agent-did>');
    process.exit(1);
  }

  if (!ctx.consentManager) {
    console.error('Consent manager not available.');
    process.exit(1);
  }

  const revoked = await ctx.consentManager.revokeAgent(agentDid);

  if (revoked) {
    console.log(`Agent ${agentDid} revoked successfully.`);
  } else {
    console.log(`No agent found with DID: ${agentDid}`);
  }
}
