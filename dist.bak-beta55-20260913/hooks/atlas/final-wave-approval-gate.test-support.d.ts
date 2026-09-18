import { mock } from "bun:test";
import type { createAtlasHook } from "./index";
import type { createToolExecuteAfterHandler } from "./tool-execute-after";
import type { SessionState, ToolExecuteAfterOutput } from "./types";
type AtlasHookContext = Parameters<typeof createAtlasHook>[0];
type PromptMock = ReturnType<typeof mock>;
export type FinalWaveMockPluginInput = AtlasHookContext & {
    _promptMock: PromptMock;
};
export type FinalWaveAfterHandlerHarness = {
    sessionState: SessionState;
    run: (toolOutput: ToolExecuteAfterOutput) => Promise<void>;
};
/**
 * Builds a mock plugin input with a recording prompt mock. `resolveParentSessionID`
 * maps a subagent task session id to the orchestrator session the task belongs to.
 */
export declare function createFinalWaveMockPluginInput(options: {
    directory: string;
    resolveParentSessionID: (taskSessionID: string) => string;
}): FinalWaveMockPluginInput;
/**
 * Registers per-test temp-directory lifecycle hooks (`.omo` scaffold + boulder state
 * cleanup) and exposes the current directory. `resetAgentRegistration` also resets
 * the shared claude-code session-state registry between tests.
 */
export declare function registerFinalWaveTestEnvironment(options?: {
    resetAgentRegistration?: boolean;
}): {
    readonly directory: string;
};
/** Writes the plan markdown plus the boulder state pointing the session at it. */
export declare function writeFinalWavePlanState(options: {
    directory: string;
    sessionID: string;
    planName: string;
    planContent: string;
}): string;
/**
 * Wraps `createToolExecuteAfterHandler` with a shared in-memory session-state map so
 * tests can assert pause/count flags. The handler factory is passed in explicitly:
 * suites that mock modules (`mock.module`) must hand over their post-mock import so
 * the harness runs against the same module instance the suite asserts on.
 */
export declare function createFinalWaveAfterHandlerHarness(options: {
    ctx: AtlasHookContext;
    sessionID: string;
    createHandler: typeof createToolExecuteAfterHandler;
}): FinalWaveAfterHandlerHarness;
export {};
