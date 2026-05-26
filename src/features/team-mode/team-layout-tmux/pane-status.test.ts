import { expect, test, describe } from "bun:test";
import { 
  formatPaneStatusBar, 
  buildPaneColorCommand, 
  buildWindowTitle, 
  formatDuration 
} from "./pane-status";

describe("pane-status", () => {
  test("formatDuration", () => {
    expect(formatDuration(500)).toBe("0s");
    expect(formatDuration(30000)).toBe("30s");
    expect(formatDuration(150000)).toBe("2m 30s");
    expect(formatDuration(7200000)).toBe("2h 0m");
  });

  test("formatPaneStatusBar", () => {
    expect(formatPaneStatusBar("my-agent", "running", 30000, 5)).toBe("[my-agent] ⏱ 30s | 🔧 5");
    expect(formatPaneStatusBar("my-agent", "idle", 1000)).toBe("[my-agent] ⏸ idle");
    expect(formatPaneStatusBar("very-long-agent-name-here", "error", 1000)).toBe("[very-long-agent-n...] ✗ error");
  });

  test("buildPaneColorCommand", () => {
    expect(buildPaneColorCommand("1", "running")).toBe("tmux select-pane -t 1 -P 'bg=colour35'");
    expect(buildPaneColorCommand("1", "idle")).toBe("tmux select-pane -t 1 -P 'bg=colour220'");
    expect(buildPaneColorCommand("1", "error")).toBe("tmux select-pane -t 1 -P 'bg=colour124'");
    expect(buildPaneColorCommand("1", "completed")).toBe("tmux select-pane -t 1 -P 'bg=colour39'");
    expect(buildPaneColorCommand("1", "blocked")).toBe("tmux select-pane -t 1");
  });

  test("buildWindowTitle", () => {
    expect(buildWindowTitle("my-team", 2, 10, 3600000)).toBe('tmux set-window-option -t window-status-format "🤖 my-team — 2/10 tasks — ⏱ 1h 0m"');
  });
});
