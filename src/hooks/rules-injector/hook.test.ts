import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createRulesInjectorHook } from "./hook";

// Mock dependencies
const mockTruncate = mock(() =>
	Promise.resolve({ result: "truncated-content", truncated: false }),
);
const mockProcessFilePathForInjection = mock(() => Promise.resolve());

mock.module("../../shared/dynamic-truncator", () => ({
	createDynamicTruncator: () => ({ truncate: mockTruncate }),
}));

mock.module("./cache", () => ({
	createSessionCacheStore: () => ({
		getSessionCache: () => ({
			contentHashes: new Set<string>(),
			realPaths: new Set<string>(),
		}),
		clearSessionCache: mock(),
	}),
	createSessionRuleScanCacheStore: () => ({
		getSessionRuleScanCache: () => ({ has: () => false, set: () => {} }),
		clearSessionRuleScanCache: mock(),
	}),
}));

mock.module("./transcript-hydration", () => ({
	createTranscriptHydrationStore: () => ({
		hydrateSession: () => Promise.resolve(new Set()),
		clearSession: mock(),
	}),
}));

mock.module("./injector", () => ({
	createRuleInjectionProcessor: () => ({
		processFilePathForInjection: mockProcessFilePathForInjection,
	}),
	clearParsedRuleCache: mock(),
}));

mock.module("./output-path", () => ({
	getRuleInjectionFilePath: (output: { metadata: unknown; title: string }) => {
		const metadata = output.metadata as Record<string, unknown> | null;
		if (metadata && typeof metadata === "object" && typeof metadata.filePath === "string") {
			return metadata.filePath;
		}
		if (typeof output.title === "string" && output.title.length > 0) {
			return output.title;
		}
		return null;
	},
}));

mock.module("./project-root-finder", () => ({
	clearProjectRootCache: mock(),
}));

mock.module("../../shared/event-session-id", () => ({
	resolveSessionEventID: (props: unknown) => {
		const p = props as Record<string, unknown> | undefined;
		return p?.sessionID as string | undefined;
	},
}));

function createMockCtx() {
	return {
		directory: "/workspace",
		client: {} as unknown,
	} as Parameters<typeof createRulesInjectorHook>[0];
}

describe("rules-injector hook", () => {
	beforeEach(() => {
		mockProcessFilePathForInjection.mockClear();
	});

	describe("#given createRulesInjectorHook is called", () => {
		it("#then returns tool.execute.before, tool.execute.after, and event handlers", () => {
			// given
			const ctx = createMockCtx();

			// when
			const hook = createRulesInjectorHook(ctx);

			// then
			expect(hook).toHaveProperty(["tool.execute.before"]);
			expect(hook).toHaveProperty(["tool.execute.after"]);
			expect(hook).toHaveProperty(["event"]);
			expect(typeof hook["tool.execute.before"]).toBe("function");
			expect(typeof hook["tool.execute.after"]).toBe("function");
			expect(typeof hook.event).toBe("function");
		});
	});

	describe("#given tool.execute.after is invoked", () => {
		describe("#when tool is a tracked tool (read)", () => {
			it("#then calls processFilePathForInjection with the file path", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);
				const input = { tool: "read", sessionID: "ses-1", callID: "call-1" };
				const output = {
					title: "/workspace/src/index.ts",
					output: "file content",
					metadata: { filePath: "/workspace/src/index.ts" },
				};

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockProcessFilePathForInjection).toHaveBeenCalledTimes(1);
				expect(mockProcessFilePathForInjection).toHaveBeenCalledWith(
					"/workspace/src/index.ts",
					"ses-1",
					output,
				);
			});
		});

		describe("#when tool is write", () => {
			it("#then calls processFilePathForInjection", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);
				const input = { tool: "write", sessionID: "ses-2", callID: "call-2" };
				const output = {
					title: "/workspace/src/file.ts",
					output: "",
					metadata: { filePath: "/workspace/src/file.ts" },
				};

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockProcessFilePathForInjection).toHaveBeenCalledTimes(1);
			});
		});

		describe("#when tool is edit", () => {
			it("#then calls processFilePathForInjection", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);
				const input = { tool: "edit", sessionID: "ses-3", callID: "call-3" };
				const output = {
					title: "/workspace/src/edit.ts",
					output: "",
					metadata: { filePath: "/workspace/src/edit.ts" },
				};

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockProcessFilePathForInjection).toHaveBeenCalledTimes(1);
			});
		});

		describe("#when tool is multiedit", () => {
			it("#then calls processFilePathForInjection", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);
				const input = { tool: "multiedit", sessionID: "ses-4", callID: "call-4" };
				const output = {
					title: "/workspace/src/multi.ts",
					output: "",
					metadata: { filePath: "/workspace/src/multi.ts" },
				};

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockProcessFilePathForInjection).toHaveBeenCalledTimes(1);
			});
		});

		describe("#when tool is not tracked (e.g. bash)", () => {
			it("#then does not call processFilePathForInjection", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);
				const input = { tool: "bash", sessionID: "ses-5", callID: "call-5" };
				const output = {
					title: "bash output",
					output: "some output",
					metadata: {},
				};

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockProcessFilePathForInjection).not.toHaveBeenCalled();
			});
		});

		describe("#when tool output has no extractable file path", () => {
			it("#then does not call processFilePathForInjection", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);
				const input = { tool: "read", sessionID: "ses-6", callID: "call-6" };
				const output = {
					title: "",
					output: "",
					metadata: null,
				};

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockProcessFilePathForInjection).not.toHaveBeenCalled();
			});
		});

		describe("#when tool name has mixed case", () => {
			it("#then normalizes to lowercase and still tracks", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);
				const input = { tool: "Read", sessionID: "ses-7", callID: "call-7" };
				const output = {
					title: "/workspace/src/file.ts",
					output: "",
					metadata: { filePath: "/workspace/src/file.ts" },
				};

				// when
				await hook["tool.execute.after"](input, output);

				// then
				expect(mockProcessFilePathForInjection).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe("#given tool.execute.before is invoked", () => {
		it("#then is a no-op (does not throw)", async () => {
			// given
			const ctx = createMockCtx();
			const hook = createRulesInjectorHook(ctx);
			const input = { tool: "read", sessionID: "ses-8", callID: "call-8" };
			const output = { args: {} };

			// when / then
			await expect(
				hook["tool.execute.before"](input, output),
			).resolves.toBeUndefined();
		});
	});

	describe("#given event handler is invoked", () => {
		describe("#when event is session.deleted", () => {
			it("#then clears session state", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);

				// when
				await hook.event({
					event: {
						type: "session.deleted",
						properties: { sessionID: "ses-del-1" },
					},
				});

				// then - no error thrown, state cleared internally
			});
		});

		describe("#when event is session.compacted", () => {
			it("#then clears session state", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);

				// when
				await hook.event({
					event: {
						type: "session.compacted",
						properties: { sessionID: "ses-compact-1" },
					},
				});

				// then - no error thrown, state cleared internally
			});
		});

		describe("#when event is unrelated", () => {
			it("#then does nothing", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);

				// when / then
				await expect(
					hook.event({
						event: { type: "session.idle", properties: {} },
					}),
				).resolves.toBeUndefined();
			});
		});

		describe("#when session.deleted has no sessionID in properties", () => {
			it("#then does not throw", async () => {
				// given
				const ctx = createMockCtx();
				const hook = createRulesInjectorHook(ctx);

				// when / then
				await expect(
					hook.event({
						event: { type: "session.deleted", properties: {} },
					}),
				).resolves.toBeUndefined();
			});
		});
	});

	describe("#given modelCacheState is provided", () => {
		it("#then creates hook without error", () => {
			// given
			const ctx = createMockCtx();

			// when
			const hook = createRulesInjectorHook(ctx, {
				anthropicContext1MEnabled: true,
			});

			// then
			expect(hook).toHaveProperty(["tool.execute.after"]);
		});
	});

	describe("#given skipClaudeUserRules option is provided", () => {
		it("#then creates hook without error", () => {
			// given
			const ctx = createMockCtx();

			// when
			const hook = createRulesInjectorHook(ctx, undefined, {
				skipClaudeUserRules: true,
			});

			// then
			expect(hook).toHaveProperty(["tool.execute.after"]);
		});
	});
});
