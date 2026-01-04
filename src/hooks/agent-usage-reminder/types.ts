export interface AgentUsageState {
  sessionID: string;
  agentUsed: boolean;
  reminderCount: number;
  updatedAt: number;
  lastAgentUseAt: number;
  directToolCallsSinceAgent: number;
}
