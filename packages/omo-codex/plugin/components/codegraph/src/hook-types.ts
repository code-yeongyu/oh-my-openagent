import type { Readable } from "node:stream";

import type {
	CodegraphCommandResult as SharedCodegraphCommandResult,
	CodegraphCommandRunner,
} from "@oh-my-opencode/codegraph-mcp";
import type { CodexOmoConfig as SharedCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import type { CodegraphProvisionResult as SharedCodegraphProvisionResult } from "../../../../../utils/src/codegraph/provision.ts";
import type {
	CodegraphCommandResolution,
	ResolveCodegraphCommandOptions,
} from "../../../../../utils/src/codegraph/resolve.ts";
import type { CodegraphConfig as SharedCodegraphConfig } from "../../../../../utils/src/omo-config.ts";
import type { CodegraphVersion } from "../../../../../utils/src/codegraph/version.ts";

export type SessionStartAction = "skipped-disabled" | "spawned";
export type PostToolUseAction = "emitted-guidance" | "skipped";
export type WorkerAction = "failed" | "initialized" | "skipped-disabled" | "skipped-status" | "skipped-unavailable" | "skipped-unsupported-node" | "synced";

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

export type CodegraphConfig = Partial<SharedCodegraphConfig>;
export type CodexOmoConfig = SharedCodexOmoConfig;
export type OmoConfigSource = CodexOmoConfig["sources"][number];
export type CodegraphCommandResult = SharedCodegraphCommandResult;
export type CodegraphProvisionResult = SharedCodegraphProvisionResult;

export interface CodegraphSessionStartOutcome {
	readonly action: WorkerAction;
	readonly error?: string;
	readonly exitCode?: number;
	readonly projectRoot?: string;
	readonly source?: CodegraphCommandResolution["source"];
	readonly timedOut?: boolean;
}

export interface CodegraphSessionStartDeps {
	readonly ensureProvisioned: (options: { readonly installDir?: string; readonly lockDir: string; readonly version: CodegraphVersion }) => Promise<CodegraphProvisionResult>;
	readonly resolveCommand: (options?: ResolveCodegraphCommandOptions) => CodegraphCommandResolution;
	readonly runCommand: CodegraphCommandRunner;
}

export interface SessionStartHookOptions {
	readonly argv?: readonly string[];
	readonly config?: CodexOmoConfig;
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly spawnWorker?: (invocation: WorkerSpawnInvocation) => void;
	readonly stdin?: Readable & { readonly isTTY?: boolean };
	readonly stdout?: HookStdout;
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
}
