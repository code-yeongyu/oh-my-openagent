import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as spawnWithWindowsHideModule from "../../shared/spawn-with-windows-hide";

const mockLoadInteractiveBashSessionState = mock(() => null);
const mockSaveInteractiveBashSessionState = mock(() => {});
const mockClearInteractiveBashSessionState = mock(() => {});
// spyOn instead of mock.module: bun module mocks are process-global and survive
// mock.restore(), so they leak into other test files that touch this module
// (order-dependent CI failures); the spy patches the shared instance in place.
const mockSpawnWithWindowsHide = spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation(() => {
  throw new Error("tmux unavailable");
});

mock.module("./storage", () => ({
  loadInteractiveBashSessionState: mockLoadInteractiveBashSessionState,
  saveInteractiveBashSessionState: mockSaveInteractiveBashSessionState,
  clearInteractiveBashSessionState: mockClearInteractiveBashSessionState,
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
