import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const mockLoadInteractiveBashSessionState = mock(() => null);
const mockSaveInteractiveBashSessionState = mock(() => {});
const mockClearInteractiveBashSessionState = mock(() => {});
const mockSpawnWithWindowsHide = mock(() => {
  throw new Error("tmux unavailable");
});

mock.module("./storage", () => ({
  loadInteractiveBashSessionState: mockLoadInteractiveBashSessionState,
  saveInteractiveBashSessionState: mockSaveInteractiveBashSessionState,
  clearInteractiveBashSessionState: mockClearInteractiveBashSessionState,
}));

mock.module("../../shared/spawn-with-windows-hide", () => ({
  spawnWithWindowsHide: mockSpawnWithWindowsHide,
}));

const trackerModulePromise = import("./interactive-bash-session-tracker");

describe("createInteractiveBashSessionTracker", () => {
  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    mockLoadInteractiveBashSessionState.mockReset();
    mockSaveInteractiveBashSessionState.mockReset();
    mockClearInteractiveBashSessionState.mockReset();
    mockSpawnWithWindowsHide.mockReset();
    mockLoadInteractiveBashSessionState.mockReturnValue(null);
    mockSpawnWithWindowsHide.mockImplementation(() => {
      throw new Error("tmux unavailable");
    });
  });

  it("#given tracked tmux session kill throws #when session is deleted #then cleanup still completes", async () => {
    // given
    const abortSession = mock(async () => undefined);
    const { createInteractiveBashSessionTracker } = await trackerModulePromise;
    const tracker = createInteractiveBashSessionTracker({ abortSession });
    tracker.handleTmuxCommand({
      sessionID: "session-1",
      subCommand: "new-session",
      sessionName: "omo-shell",
      toolOutput: "",
    });

    // when
    await tracker.handleSessionDeleted("session-1");

    // then
    expect(mockSpawnWithWindowsHide).toHaveBeenCalledWith(["tmux", "kill-session", "-t", "omo-shell"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(mockClearInteractiveBashSessionState).toHaveBeenCalledWith("session-1");
  });
});
