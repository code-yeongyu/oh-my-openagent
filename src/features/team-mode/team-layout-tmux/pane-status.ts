export type AgentStatus = "running" | "idle" | "blocked" | "error" | "completed";

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

export const formatPaneStatusBar = (
  agent: string,
  status: AgentStatus,
  durationMs: number,
  toolCalls?: number
): string => {
  const truncatedAgent = agent.length > 20 ? agent.substring(0, 17) + "..." : agent;
  const duration = formatDuration(durationMs);

  switch (status) {
    case "running":
      return `[${truncatedAgent}] ⏱ ${duration} ${toolCalls !== undefined ? `| 🔧 ${toolCalls}` : ""}`;
    case "idle":
      return `[${truncatedAgent}] ⏸ idle`;
    case "error":
      return `[${truncatedAgent}] ✗ error`;
    case "completed":
      return `[${truncatedAgent}] ✓ completed`;
    case "blocked":
      return `[${truncatedAgent}] 🛑 blocked`;
    default:
      return `[${truncatedAgent}] ${status}`;
  }
};

export const buildPaneColorCommand = (paneId: string, status: AgentStatus): string => {
  let color = "";
  switch (status) {
    case "running":
      color = "colour35";
      break;
    case "idle":
      color = "colour220";
      break;
    case "error":
      color = "colour124";
      break;
    case "completed":
      color = "colour39";
      break;
    default:
      return `tmux select-pane -t ${paneId}`;
  }
  return `tmux select-pane -t ${paneId} -P 'bg=${color}'`;
};

export const buildWindowTitle = (
  teamName: string,
  tasksCompleted: number,
  tasksTotal: number,
  elapsedMs: number
): string => {
  const duration = formatDuration(elapsedMs);
  return `tmux set-window-option -t window-status-format "🤖 ${teamName} — ${tasksCompleted}/${tasksTotal} tasks — ⏱ ${duration}"`;
};
