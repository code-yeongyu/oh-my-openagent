import { createHash } from "node:crypto";
import { DEFAULT_HOOK_TIMEOUT_SECONDS, isValidHookTimeoutSeconds } from "./safety.ts";
import type {
	ExecutableHookHandler,
	HookSourceMetadata,
	HookSourceScope,
	HookTrustEntry,
	HookTrustState,
} from "./types.ts";

export type HookTrustPlatform = NodeJS.Platform;
export type HookTrustStorageScope = "global" | "project";

export type HookTrustOptions = {
	readonly platform?: HookTrustPlatform;
};

export type HookTrustStorageOptions = {
	readonly projectTrusted: boolean;
};

export type HookTrustRecord = {
	readonly id: string;
	readonly currentHash: string;
	readonly enabled: boolean;
	readonly trusted: boolean;
	readonly executable: boolean;
	readonly scope: HookSourceScope;
	readonly sourcePath: string;
	readonly matcher?: string;
	readonly commandPreview: string;
	readonly entry?: HookTrustEntry;
};

type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue | undefined };

const HOOK_STATE_VERSION = 1;

export function emptyHookTrustState(): HookTrustState {
	return { version: HOOK_STATE_VERSION, hooks: {} };
}

export function hookTrustId(handler: ExecutableHookHandler): string {
	return `hk_${sourceKeyHash(handler.source)}_${handler.event}_${handler.groupIndex}_${handler.handlerIndex}`;
}

export function buildHookTrustRecord(handler: ExecutableHookHandler, options: HookTrustOptions = {}): HookTrustRecord {
	const id = hookTrustId(handler);
	const currentHash = hashCommandHook(handler, options);
	const commandPreview = selectedCommand(handler, options.platform ?? process.platform);
	return {
		id,
		currentHash,
		enabled: true,
		trusted: false,
		executable: false,
		scope: handler.source.scope,
		sourcePath: handler.source.sourcePath,
		...(handler.matcher === undefined ? {} : { matcher: handler.matcher }),
		commandPreview,
	};
}

export function createHookTrustEntry(
	handler: ExecutableHookHandler,
	options: HookTrustOptions & { readonly updatedAt?: string } = {},
): HookTrustEntry {
	const commandPreview = selectedCommand(handler, options.platform ?? process.platform);
	return {
		enabled: true,
		trustedHash: hashCommandHook(handler, options),
		scope: handler.source.scope,
		sourcePath: handler.source.sourcePath,
		...(handler.matcher === undefined ? {} : { matcher: handler.matcher }),
		commandPreview,
		updatedAt: options.updatedAt ?? new Date().toISOString(),
	};
}

export function hashCommandHook(handler: ExecutableHookHandler, options: HookTrustOptions = {}): string {
	const platform = options.platform ?? process.platform;
	const hook: { [key: string]: JsonValue | undefined } = {
		async: false,
		command: handler.config.command,
		commandWindows: handler.config.commandWindows,
		platformCommand: selectedCommand(handler, platform),
		statusMessage: handler.config.statusMessage,
		timeout: normalizedTimeout(handler.config.timeout),
		type: "command",
	};
	const identity: { [key: string]: JsonValue | undefined } = {
		event: handler.event,
		hook,
		matcher: handler.matcher,
		sourceKeyHash: sourceKeyHash(handler.source),
	};
	return `sha256:${sha256Hex(JSON.stringify(canonicalJson(identity)))}`;
}

export function isCommandHookTrusted(
	handler: ExecutableHookHandler,
	state: HookTrustState,
	options: HookTrustOptions = {},
): boolean {
	const record = buildStatefulHookTrustRecord(handler, state, options);
	return record.executable;
}

export function listHookTrustRecords(
	handlers: readonly ExecutableHookHandler[],
	state: HookTrustState,
	options: HookTrustOptions = {},
): readonly HookTrustRecord[] {
	return handlers.map((handler) => buildStatefulHookTrustRecord(handler, state, options));
}

export function filterExecutableTrustedHooks(
	handlers: readonly ExecutableHookHandler[],
	state: HookTrustState,
	options: HookTrustOptions = {},
): readonly ExecutableHookHandler[] {
	return handlers.filter((handler) => buildStatefulHookTrustRecord(handler, state, options).executable);
}

export function readHookTrustStateJson(input: string | undefined): HookTrustState {
	if (input === undefined || input.trim() === "") {
		return emptyHookTrustState();
	}
	try {
		return parseHookTrustState(JSON.parse(input));
	} catch (error) {
		if (error instanceof Error) {
			return emptyHookTrustState();
		}
		return emptyHookTrustState();
	}
}

export function hookTrustStorageScope(
	handler: ExecutableHookHandler,
	options: HookTrustStorageOptions,
): HookTrustStorageScope | undefined {
	if (handler.source.scope === "project") {
		return options.projectTrusted ? "project" : undefined;
	}
	return "global";
}

function buildStatefulHookTrustRecord(
	handler: ExecutableHookHandler,
	state: HookTrustState,
	options: HookTrustOptions,
): HookTrustRecord {
	const base = buildHookTrustRecord(handler, options);
	const entry = state.hooks[base.id];
	const enabled = entry?.enabled ?? true;
	const trusted = entry?.trustedHash === base.currentHash;
	return {
		...base,
		enabled,
		trusted,
		executable: enabled && trusted,
		...(entry === undefined ? {} : { entry }),
	};
}

function parseHookTrustState(input: unknown): HookTrustState {
	if (!isRecord(input) || input.version !== HOOK_STATE_VERSION || !isRecord(input.hooks)) {
		return emptyHookTrustState();
	}

	const hooks: Record<string, HookTrustEntry> = {};
	for (const [id, entry] of Object.entries(input.hooks)) {
		const parsed = parseHookTrustEntry(entry);
		if (parsed !== undefined) {
			hooks[id] = parsed;
		}
	}
	return { version: HOOK_STATE_VERSION, hooks };
}

function parseHookTrustEntry(input: unknown): HookTrustEntry | undefined {
	if (!isRecord(input)) {
		return undefined;
	}
	const enabled = input.enabled;
	const trustedHash = input.trustedHash;
	const scope = input.scope;
	const sourcePath = input.sourcePath;
	const matcher = input.matcher;
	const commandPreview = input.commandPreview;
	const updatedAt = input.updatedAt;
	if (
		typeof enabled !== "boolean" ||
		(trustedHash !== undefined && typeof trustedHash !== "string") ||
		!isHookSourceScope(scope) ||
		typeof sourcePath !== "string" ||
		(matcher !== undefined && typeof matcher !== "string") ||
		typeof commandPreview !== "string" ||
		typeof updatedAt !== "string"
	) {
		return undefined;
	}
	return {
		enabled,
		...(trustedHash === undefined ? {} : { trustedHash }),
		scope,
		sourcePath,
		...(matcher === undefined ? {} : { matcher }),
		commandPreview,
		updatedAt,
	};
}

function selectedCommand(handler: ExecutableHookHandler, platform: HookTrustPlatform): string {
	if (platform === "win32" && handler.config.commandWindows !== undefined) {
		return handler.config.commandWindows;
	}
	return handler.config.command;
}

function normalizedTimeout(timeout: number | undefined): number {
	if (timeout === undefined) {
		return DEFAULT_HOOK_TIMEOUT_SECONDS;
	}
	if (!isValidHookTimeoutSeconds(timeout)) {
		throw new Error("Invalid command hook timeout reached trust hashing.");
	}
	return timeout;
}

function sourceKeyHash(source: HookSourceMetadata): string {
	return sha256Hex(
		[source.scope, source.sourcePath, source.pluginRoot ?? "", source.manifestPath ?? ""].join("\0"),
	).slice(0, 12);
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map(canonicalJson);
	}
	if (!isJsonRecord(value)) {
		return value;
	}
	const result: { [key: string]: JsonValue } = {};
	for (const key of Object.keys(value).sort()) {
		const child = value[key];
		if (child !== undefined) {
			result[key] = canonicalJson(child);
		}
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue | undefined } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHookSourceScope(value: unknown): value is HookSourceScope {
	return (
		value === "global" ||
		value === "project" ||
		value === "plugin" ||
		value === "runtime" ||
		value === "cli" ||
		value === "managed"
	);
}
