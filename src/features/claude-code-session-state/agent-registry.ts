const sessionAgentMap = new Map<string, string>();

export function setSessionAgent(sessionId: string, agentName: string): void {
  sessionAgentMap.set(sessionId, agentName);
}

export function getAgentForSession(sessionId: string): string {
  return sessionAgentMap.get(sessionId) || "main";
}

export function clearSessionAgent(sessionId: string): void {
  sessionAgentMap.delete(sessionId);
}
