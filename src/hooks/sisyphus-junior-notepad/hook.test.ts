import { beforeEach, describe, expect, it, mock } from "bun:test";

const mockIsCallerOrchestrator = mock(() => Promise.resolve(false));
const mockReplaceToolArgs = mock();

mock.module("../../shared/session-utils", () => ({
	isCallerOrchestrator: (...args: unknown[]) => mockIsCallerOrchestrator(...args),
}));

mock.module("../../shared/system-directive", () => ({
	SYSTEM_DIRECTIVE_PREFIX: "[SYSTEM DIRECTIVE: OH-MY-OPENCODE",
}));

mock.module("../../shared/logger", () => ({
	log: mock(),
}));

mock.module("../../shared/replace-tool-args", () => ({
	replaceToolArgs: (...args: unknown[]) => mockReplaceToolArgs(...args),
}));

import { createSisyphusJuniorNotepadHook } from "./hook";
import { NOTEPAD_DIRECTIVE } from "./constants";

function createMockCtx() {
	return {
		directory: "/workspace",
		client: {},
	} as unknown as Parameters<typeof createSisyphusJuniorNotepadHook>[0];
}

describe("sisyphus-junior-notepad hook", () => {
	beforeEach(() => {
		mockIsCallerOrchestrator.mockClear();
		mockReplaceToolArgs.mockClear();
	});

	describe("#given createSisyphusJuniorNotepadHook is called", () => {
		it("#then returns tool.execute.before handler", () => {
			// given
			const ctx = createMockCtx();

			// when
			const hook = createSisyphusJuniorNotepadHook(ctx);

			// then
			expect(hook).toHaveProperty(["tool.execute.before"]);
			expect(typeof hook["tool.execute.before"]).toBe("function");
		});
	});

	describe("#given tool.execute.before is invoked", () => {
		describe("#when tool is not 'task'", () => {
			it("#then does nothing", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createSisyphusJuniorNotepadHook(ctx);
				const input = { tool: "bash", sessionID: "ses-1", callID: "call-1" };
				const output = { args: { prompt: "do something" } };

				// when
				await hook["tool.execute.before"](input, output);

				// then
				expect(mockIsCallerOrchestrator).not.toHaveBeenCalled();
				expect(mockReplaceToolArgs).not.toHaveBeenCalled();
			});
		});

		describe("#when tool is 'task' but caller is not orchestrator", () => {
			it("#then does nothing", async () => {
				// given
				mockIsCallerOrchestrator.mockImplementation(() => Promise.resolve(false));
				const ctx = createMockCtx();
				const hook = createSisyphusJuniorNotepadHook(ctx);
				const input = { tool: "task", sessionID: "ses-2", callID: "call-2" };
				const output = { args: { prompt: "implement feature" } };

				// when
				await hook["tool.execute.before"](input, output);

				// then
				expect(mockIsCallerOrchestrator).toHaveBeenCalledWith("ses-2", ctx.client);
				expect(mockReplaceToolArgs).not.toHaveBeenCalled();
			});
		});

		describe("#when tool is 'task', caller is orchestrator, but no prompt", () => {
			it("#then does nothing", async () => {
				// given
				mockIsCallerOrchestrator.mockImplementation(() => Promise.resolve(true));
				const ctx = createMockCtx();
				const hook = createSisyphusJuniorNotepadHook(ctx);
				const input = { tool: "task", sessionID: "ses-3", callID: "call-3" };
				const output = { args: {} };

				// when
				await hook["tool.execute.before"](input, output);

				// then
				expect(mockReplaceToolArgs).not.toHaveBeenCalled();
			});
		});

		describe("#when tool is 'task', caller is orchestrator, prompt already has directive", () => {
			it("#then does not double-inject", async () => {
				// given
				mockIsCallerOrchestrator.mockImplementation(() => Promise.resolve(true));
				const ctx = createMockCtx();
				const hook = createSisyphusJuniorNotepadHook(ctx);
				const input = { tool: "task", sessionID: "ses-4", callID: "call-4" };
				const output = {
					args: { prompt: "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - EXISTING] do work" },
				};

				// when
				await hook["tool.execute.before"](input, output);

				// then
				expect(mockReplaceToolArgs).not.toHaveBeenCalled();
			});
		});

		describe("#when tool is 'task', caller is orchestrator, prompt is valid", () => {
			it("#then prepends notepad directive to prompt", async () => {
				// given
				mockIsCallerOrchestrator.mockImplementation(() => Promise.resolve(true));
				const ctx = createMockCtx();
				const hook = createSisyphusJuniorNotepadHook(ctx);
				const input = { tool: "task", sessionID: "ses-5", callID: "call-5" };
				const output = { args: { prompt: "implement the feature" } };

				// when
				await hook["tool.execute.before"](input, output);

				// then
				expect(mockReplaceToolArgs).toHaveBeenCalledTimes(1);
				expect(mockReplaceToolArgs).toHaveBeenCalledWith(output, {
					prompt: NOTEPAD_DIRECTIVE + "implement the feature",
				});
			});
		});

		describe("#when tool name has different casing", () => {
			it("#then does not match (exact match required)", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createSisyphusJuniorNotepadHook(ctx);
				const input = { tool: "Task", sessionID: "ses-6", callID: "call-6" };
				const output = { args: { prompt: "do work" } };

				// when
				await hook["tool.execute.before"](input, output);

				// then
				expect(mockIsCallerOrchestrator).not.toHaveBeenCalled();
				expect(mockReplaceToolArgs).not.toHaveBeenCalled();
			});
		});
	});
});
