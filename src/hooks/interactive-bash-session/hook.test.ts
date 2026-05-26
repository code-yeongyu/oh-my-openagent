import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { InteractiveBashSessionState } from "./types";

const mockSaveState = mock();
const mockClearState = mock();
const mockLoadState = mock(() => null);
const mockKillAllTrackedSessions = mock(() => Promise.resolve());
const mockSubagentSessions = new Set<string>();

mock.module("./storage", () => ({
	saveInteractiveBashSessionState: (...args: unknown[]) => mockSaveState(...args),
	clearInteractiveBashSessionState: (...args: unknown[]) => mockClearState(...args),
	loadInteractiveBashSessionState: (...args: unknown[]) => mockLoadState(...args),
}));

mock.module("./state-manager", () => ({
	getOrCreateState: (sessionID: string, sessionStates: Map<string, InteractiveBashSessionState>) => {
		const existing = sessionStates.get(sessionID);
		if (existing) return existing;
		const state: InteractiveBashSessionState = {
			sessionID,
			tmuxSessions: new Set<string>(),
			updatedAt: Date.now(),
		};
		sessionStates.set(sessionID, state);
		return state;
	},
	isOmoSession: (sessionName: string | null): sessionName is string => {
		return sessionName !== null && sessionName.startsWith("omo-");
	},
	killAllTrackedSessions: (...args: unknown[]) => mockKillAllTrackedSessions(...args),
}));

mock.module("../../features/claude-code-session-state", () => ({
	subagentSessions: mockSubagentSessions,
}));

mock.module("../../shared/event-session-id", () => ({
	resolveSessionEventID: (props: unknown) => {
		const p = props as Record<string, unknown> | undefined;
		return p?.sessionID as string | undefined;
	},
}));

import { createInteractiveBashSessionHook } from "./hook";

function createMockCtx() {
	return {
		directory: "/workspace",
		client: {
			session: {
				abort: mock(() => Promise.resolve()),
			},
		},
	} as unknown as Parameters<typeof createInteractiveBashSessionHook>[0];
}

describe("interactive-bash-session hook", () => {
	beforeEach(() => {
		mockSaveState.mockClear();
		mockClearState.mockClear();
		mockLoadState.mockClear();
		mockKillAllTrackedSessions.mockClear();
		mockSubagentSessions.clear();
	});

	describe("#given createInteractiveBashSessionHook is called", () => {
		it("#then returns tool.execute.after and event handlers", () => {
			// given
			const ctx = createMockCtx();

			// when
			const hook = createInteractiveBashSessionHook(ctx);

			// then
			expect(hook).toHaveProperty(["tool.execute.after"]);
			expect(hook).toHaveProperty(["event"]);
			expect(typeof hook["tool.execute.after"]).toBe("function");
			expect(typeof hook.event).toBe("function");
		});
	});

	describe("#given tool.execute.after is invoked", () => {
		describe("#when tool is not interactive_bash", () => {
			it("#then does nothing", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const input = { tool: "bash", sessionID: "ses-1", callID: "call-1", args: {} };
				const output = { title: "", output: "", metadata: {} };

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockSaveState).not.toHaveBeenCalled();
			});
		});

		describe("#when tool is interactive_bash but no tmux_command arg", () => {
			it("#then does nothing", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const input = {
					tool: "interactive_bash",
					sessionID: "ses-2",
					callID: "call-2",
					args: { command: "ls" },
				};
				const output = { title: "", output: "", metadata: {} };

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockSaveState).not.toHaveBeenCalled();
			});
		});

		describe("#when output starts with Error:", () => {
			it("#then returns early without tracking", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const input = {
					tool: "interactive_bash",
					sessionID: "ses-3",
					callID: "call-3",
					args: { tmux_command: "new-session -s omo-test" },
				};
				const output = { title: "", output: "Error: session not found", metadata: {} };

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockSaveState).not.toHaveBeenCalled();
			});
		});

		describe("#when new-session with omo- prefix", () => {
			it("#then tracks the session and saves state", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const input = {
					tool: "interactive_bash",
					sessionID: "ses-4",
					callID: "call-4",
					args: { tmux_command: "new-session -s omo-dev" },
				};
				const output = { title: "", output: "session created", metadata: {} };

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockSaveState).toHaveBeenCalledTimes(1);
				const savedState = mockSaveState.mock.calls[0][0] as InteractiveBashSessionState;
				expect(savedState.tmuxSessions.has("omo-dev")).toBe(true);
			});

			it("#then appends session reminder to output", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const input = {
					tool: "interactive_bash",
					sessionID: "ses-5",
					callID: "call-5",
					args: { tmux_command: "new-session -s omo-work" },
				};
				const output = { title: "", output: "ok", metadata: {} };

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(output.output).toContain("Active omo-* tmux sessions");
				expect(output.output).toContain("omo-work");
			});
		});

		describe("#when new-session without omo- prefix", () => {
			it("#then does not track the session", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const input = {
					tool: "interactive_bash",
					sessionID: "ses-6",
					callID: "call-6",
					args: { tmux_command: "new-session -s my-session" },
				};
				const output = { title: "", output: "ok", metadata: {} };

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockSaveState).not.toHaveBeenCalled();
			});
		});

		describe("#when kill-session with omo- prefix", () => {
			it("#then removes the session from tracking", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const sessionID = "ses-7";

				// first create a session
				await hook["tool.execute.after"](
					{
						tool: "interactive_bash",
						sessionID,
						callID: "call-7a",
						args: { tmux_command: "new-session -s omo-temp" },
					},
					{ title: "", output: "ok", metadata: {} },
				);
				mockSaveState.mockClear();

				// when
				const output = { title: "", output: "ok", metadata: {} };
				await hook["tool.execute.after"](
					{
						tool: "interactive_bash",
						sessionID,
						callID: "call-7b",
						args: { tmux_command: "kill-session -t omo-temp" },
					},
					output,
				);

				// then
				expect(mockSaveState).toHaveBeenCalledTimes(1);
				const savedState = mockSaveState.mock.calls[0][0] as InteractiveBashSessionState;
				expect(savedState.tmuxSessions.has("omo-temp")).toBe(false);
			});
		});

		describe("#when kill-server", () => {
			it("#then clears all tracked sessions", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const sessionID = "ses-8";

				// create sessions first
				await hook["tool.execute.after"](
					{
						tool: "interactive_bash",
						sessionID,
						callID: "call-8a",
						args: { tmux_command: "new-session -s omo-a" },
					},
					{ title: "", output: "ok", metadata: {} },
				);
				await hook["tool.execute.after"](
					{
						tool: "interactive_bash",
						sessionID,
						callID: "call-8b",
						args: { tmux_command: "new-session -s omo-b" },
					},
					{ title: "", output: "ok", metadata: {} },
				);
				mockSaveState.mockClear();

				// when
				await hook["tool.execute.after"](
					{
						tool: "interactive_bash",
						sessionID,
						callID: "call-8c",
						args: { tmux_command: "kill-server" },
					},
					{ title: "", output: "ok", metadata: {} },
				);

				// then
				expect(mockSaveState).toHaveBeenCalledTimes(1);
				const savedState = mockSaveState.mock.calls[0][0] as InteractiveBashSessionState;
				expect(savedState.tmuxSessions.size).toBe(0);
			});
		});

		describe("#when non-session tmux command (e.g. send-keys)", () => {
			it("#then does not modify state or append reminder", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);
				const input = {
					tool: "interactive_bash",
					sessionID: "ses-9",
					callID: "call-9",
					args: { tmux_command: "send-keys -t omo-dev 'ls' Enter" },
				};
				const output = { title: "", output: "ok", metadata: {} };

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockSaveState).not.toHaveBeenCalled();
				expect(output.output).toBe("ok");
			});
		});
	});

	describe("#given event handler is invoked", () => {
		describe("#when event is session.deleted with valid sessionID", () => {
			it("#then kills tracked sessions and clears state", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);

				// when
				await hook.event({
					event: {
						type: "session.deleted",
						properties: { sessionID: "ses-del-1" },
					},
				});

				// then
				expect(mockKillAllTrackedSessions).toHaveBeenCalledTimes(1);
				expect(mockClearState).toHaveBeenCalledWith("ses-del-1");
			});
		});

		describe("#when event is session.deleted without sessionID", () => {
			it("#then does nothing", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);

				// when
				await hook.event({
					event: {
						type: "session.deleted",
						properties: {},
					},
				});

				// then
				expect(mockKillAllTrackedSessions).not.toHaveBeenCalled();
				expect(mockClearState).not.toHaveBeenCalled();
			});
		});

		describe("#when event is unrelated", () => {
			it("#then does nothing", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createInteractiveBashSessionHook(ctx);

				// when
				await hook.event({
					event: { type: "session.idle", properties: {} },
				});

				// then
				expect(mockKillAllTrackedSessions).not.toHaveBeenCalled();
			});
		});
	});
});
