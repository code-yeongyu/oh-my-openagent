import type { Readable } from "node:stream";

import type { CodexOmoConfig as SharedCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import type { CODEGRAPH_PINNED_VERSION } from "../../../../../utils/src/codegraph/manifest.ts";
import type { SweepCodegraphZombiesOptions } from "../../../../../utils/src/codegraph/process-sweep.ts";
import type { CodegraphProvisionResult as SharedCodegraphProvisionResult } from "../../../../../utils/src/codegraph/provision.ts";
import type {
	CodegraphCommandResolution,
	ResolveCodegraphCommandOptions,
} from "../../../../../utils/src/codegraph/resolve.ts";
import type { CodegraphWorkspacePreparation as SharedCodegraphWorkspacePreparation } from "../../../../../utils/src/codegraph/workspace.ts";
import type { CodegraphConfig as SharedCodegraphConfig } from "../../../../../utils/src/omo-config.ts";
import type { CodegraphAncestorState, CodegraphProjectState } from "./session-start-project.js";

export type SessionStartAction =
	| "skipped-cooldown"
	| "skipped-disabled"
	| "skipped-excluded"
	| "skipped-inconclusive"
	| "skipped-initialized"
	| "skipped-locked"
	| "skipped-nested-root"
	| "skipped-spawn-error"
	| "spawned";
export type PostToolUseAction = "emitted-guidance" | "skipped";
export type WorkerAction =
	| "failed"
	| "initialized"
	| "skipped-disabled"
	| "skipped-initialized"
	| "skipped-locked"
	| "skipped-nested-root"
	| "skipped-probe-error"
	| "skipped-status"
	| "skipped-unavailable"
	| "skipped-unsupported-node"
	| "synced";
export type SessionStartOutcomeAction = SessionStartAction | WorkerAction;

export interface WorkerSpawnInvocation {
	readonly args: readonly string[];
	readonly command: string;
	readonly env: Record<string, string | undefined>;
}

export interface HookStdout {
	readonly write: (chunk: string) => void;
}

export interface SessionStartHookResult {
	readonly action: SessionStartAction;
	readonly exitCode: 0;
}

export interface PostToolUseHookResult {
	readonly action: PostToolUseAction;
	readonly exitCode: 0;
}

export interface CodegraphCommandResult {
	readonly exitCode: number;
	readonly stderr?: string;
	readonly stdout: string;
	readonly timedOut: boolean;
}

export type CodegraphConfig = Partial<SharedCodegraphConfig>;
export type CodexOmoConfig = SharedCodexOmoConfig;
export type OmoConfigSource = CodexOmoConfig["sources"][number];
export type CodegraphProvisionResult = SharedCodegraphProvisionResult;
export type CodegraphWorkspacePreparation = SharedCodegraphWorkspacePreparation;

export interface CodegraphSessionStartOutcome {
	readonly action: SessionStartOutcomeAction;
	readonly ancestorRoot?: string;
	readonly cooldownUntil?: number;
	readonly error?: string;
	readonly exitCode?: number;
	readonly failureCount?: number;
	readonly projectRoot?: string;
	readonly source?: CodegraphCommandResolution["source"];
	readonly timedOut?: boolean;
}

export interface CodegraphSessionStartDeps {
	readonly ensureGitignored: (projectRoot: string) => boolean;
	readonly ensureProvisioned: (options: { readonly installDir?: string; readonly lockDir: string; readonly version: typeof CODEGRAPH_PINNED_VERSION }) => Promise<CodegraphProvisionResult>;
	readonly managedInstallExists: (installDir: string) => boolean;
	readonly prepareWorkspace: (projectRoot: string, options: { readonly homeDir: string }) => CodegraphWorkspacePreparation;
	readonly resolveCommand: (options?: ResolveCodegraphCommandOptions) => CodegraphCommandResolution;
	readonly resolveManagedBin: (installDir: string) => string | null;
	readonly runCommand: (
		projectRoot: string,
		command: string,
		args: readonly string[],
		options: { readonly env: Record<string, string>; readonly timeoutMs: number },
	) => Promise<CodegraphCommandResult>;
}

export interface SessionStartHookOptions {
	readonly ancestorProbe?: (projectRoot: string) => CodegraphAncestorState;
	readonly argv?: readonly string[];
	readonly config?: CodexOmoConfig;
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly lockStaleMs?: number;
	readonly logOutcome?: (outcome: CodegraphSessionStartOutcome) => void;
	readonly nowMs?: number;
	readonly spawnWorker?: (invocation: WorkerSpawnInvocation) => void;
	readonly stdin?: Readable & { readonly isTTY?: boolean };
	readonly stdout?: HookStdout;
	readonly sweepZombies?: (options: SweepCodegraphZombiesOptions) => Promise<unknown> | unknown;
	readonly workerCliPath?: string;
}

export interface PostToolUseHookOptions {
	readonly env?: Record<string, string | undefined>;
	readonly stdin?: Readable & { readonly isTTY?: boolean };
	readonly stdout?: HookStdout;
}

export interface SessionStartWorkerOptions {
	readonly config?: CodexOmoConfig;
	readonly cwd?: string;
	readonly deps?: Partial<CodegraphSessionStartDeps>;
	readonly env?: Record<string, string | undefined>;
	readonly logOutcome?: (outcome: CodegraphSessionStartOutcome) => void;
	readonly nodeVersion?: string;
	readonly nowMs?: number;
	readonly projectProbe?: (projectRoot: string) => CodegraphProjectState;
}
