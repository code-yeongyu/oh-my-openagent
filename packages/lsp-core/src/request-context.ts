import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface LspRequestContext {
	readonly cwd: string;
	readonly projectConfigPaths: readonly string[];
	readonly userConfigPath: string;
	readonly installDecisionsPath: string;
	readonly capabilities: {
		readonly installDecisionTool: boolean;
	};
}

export type RequestContext = LspRequestContext;

export interface StandaloneMcpRequestContextInput {
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly homeDir?: string;
}

export class LspRequestContextParseError extends Error {
	override readonly name = "LspRequestContextParseError";

	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

export class LspRequestContextUnavailableError extends Error {
	override readonly name = "LspRequestContextUnavailableError";

	constructor() {
		super(
			"LSP request context is required. Standalone MCP startup must install one with runWithRequestContext(createStandaloneMcpRequestContext()).",
		);
	}
}

const storage = new AsyncLocalStorage<LspRequestContext>();
const CONTEXT_FIELDS = new Set(["cwd", "projectConfigPaths", "userConfigPath", "installDecisionsPath", "capabilities"]);
const CAPABILITY_FIELDS = new Set(["installDecisionTool"]);

export function runWithRequestContext<T>(context: LspRequestContext, fn: () => T): T {
	return storage.run(context, fn);
}

export function lspRequestContext(): LspRequestContext {
	const context = storage.getStore();
	if (!context) throw new LspRequestContextUnavailableError();
	return context;
}

export function contextCwd(): string {
	return lspRequestContext().cwd;
}

export function contextEnv(key: string): string | undefined {
	const context = lspRequestContext();
	if (key === "LSP_TOOLS_MCP_PROJECT_CONFIG") return context.projectConfigPaths.join(delimiter);
	if (key === "LSP_TOOLS_MCP_USER_CONFIG") return context.userConfigPath;
	if (key === "LSP_TOOLS_MCP_INSTALL_DECISIONS") return context.installDecisionsPath;
	return undefined;
}

export function createStandaloneMcpRequestContext(
	input: StandaloneMcpRequestContextInput = {},
): LspRequestContext {
	const env = input.env ?? process.env;
	const cwd = canonicalCwd(input.cwd ?? process.cwd());
	const home = input.homeDir ?? homedir();
	const projectConfigPaths = translateProjectConfigEnv(env["LSP_TOOLS_MCP_PROJECT_CONFIG"], cwd);
	const userConfigPath = translateHomeConfigEnv(env["LSP_TOOLS_MCP_USER_CONFIG"], home, ".codex/lsp-client.json");
	const installDecisionsPath = translateHomeConfigEnv(
		env["LSP_TOOLS_MCP_INSTALL_DECISIONS"],
		home,
		".codex/lsp-install-decisions.json",
	);
	return parseLspRequestContext({
		cwd,
		projectConfigPaths,
		userConfigPath,
		installDecisionsPath,
		capabilities: { installDecisionTool: true },
	});
}

export function parseLspRequestContext(value: unknown): LspRequestContext {
	if (!isRecord(value)) {
		throw new LspRequestContextParseError("invalid_context", "LSP request context must be an object.");
	}
	rejectUnknownFields(value, CONTEXT_FIELDS, "context");

	const cwd = stringField(value, "cwd");
	const projectConfigPaths = stringArrayField(value, "projectConfigPaths");
	const userConfigPath = stringField(value, "userConfigPath");
	const installDecisionsPath = stringField(value, "installDecisionsPath");
	const capabilities = capabilitiesField(value["capabilities"]);
	const canonical = canonicalCwd(cwd);

	for (const path of projectConfigPaths) {
		requireAbsolutePath(path, "projectConfigPaths");
		const projectPath = canonicalizeExistingOrNearestAncestor(path);
		if (!isPathInside(canonical, projectPath)) {
			throw new LspRequestContextParseError(
				"project_config_outside_cwd",
				`Project LSP config path must be inside cwd: ${path}`,
			);
		}
	}
	requireAbsolutePath(userConfigPath, "userConfigPath");
	requireAbsolutePath(installDecisionsPath, "installDecisionsPath");

	return {
		cwd: canonical,
		projectConfigPaths: projectConfigPaths.map((path) => canonicalizeExistingOrNearestAncestor(path)),
		userConfigPath,
		installDecisionsPath,
		capabilities,
	};
}

function translateProjectConfigEnv(value: string | undefined, cwd: string): readonly string[] {
	if (value === undefined || value.length === 0) return [join(cwd, ".codex", "lsp-client.json")];
	return value
		.split(delimiter)
		.filter((entry) => entry.length > 0)
		.map((entry) => (isAbsolute(entry) ? entry : join(cwd, entry)));
}

function translateHomeConfigEnv(value: string | undefined, home: string, fallback: string): string {
	if (value === undefined || value.length === 0) return join(home, fallback);
	return isAbsolute(value) ? value : join(home, value);
}

function canonicalCwd(cwd: string): string {
	const resolved = resolve(cwd);
	if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
		throw new LspRequestContextParseError("invalid_cwd", `LSP request cwd must be an existing directory: ${cwd}`);
	}
	return realpathSync(resolved);
}

export function canonicalizeExistingOrNearestAncestor(path: string): string {
	let current = resolve(path);
	const suffix: string[] = [];
	while (true) {
		try {
			const existing = realpathSync(current);
			return suffix.length === 0 ? existing : join(existing, ...suffix);
		} catch (error) {
			if (!isMissingPathError(error)) throw error;
			const parent = dirname(current);
			if (parent === current) throw error;
			suffix.unshift(basename(current));
			current = parent;
		}
	}
}

function capabilitiesField(value: unknown): LspRequestContext["capabilities"] {
	if (!isRecord(value)) {
		throw new LspRequestContextParseError("invalid_capabilities", "LSP request capabilities must be an object.");
	}
	rejectUnknownFields(value, CAPABILITY_FIELDS, "capabilities");
	const installDecisionTool = value["installDecisionTool"];
	if (typeof installDecisionTool !== "boolean") {
		throw new LspRequestContextParseError(
			"invalid_install_decision_capability",
			"LSP request capabilities.installDecisionTool must be a boolean.",
		);
	}
	return { installDecisionTool };
}

function stringField(value: Record<string, unknown>, field: string): string {
	const fieldValue = value[field];
	if (typeof fieldValue !== "string" || fieldValue.length === 0) {
		throw new LspRequestContextParseError("invalid_field", `LSP request context.${field} must be a non-empty string.`);
	}
	return fieldValue;
}

function stringArrayField(value: Record<string, unknown>, field: string): readonly string[] {
	const fieldValue = value[field];
	if (!Array.isArray(fieldValue) || !fieldValue.every((item) => typeof item === "string" && item.length > 0)) {
		throw new LspRequestContextParseError(
			"invalid_field",
			`LSP request context.${field} must be a non-empty string array.`,
		);
	}
	return fieldValue;
}

function requireAbsolutePath(path: string, field: string): void {
	if (!isAbsolute(path)) {
		throw new LspRequestContextParseError("relative_path", `LSP request context.${field} must be absolute: ${path}`);
	}
}

export function isPathInside(parent: string, child: string): boolean {
	const childPath = resolve(child);
	const relativePath = relative(parent, childPath);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isMissingPathError(error: unknown): boolean {
	const code = errorCode(error);
	return code === "ENOENT" || code === "ENOTDIR";
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, scope: string): void {
	const unknown = Object.keys(value).filter((key) => !allowed.has(key));
	if (unknown.length > 0) {
		throw new LspRequestContextParseError(
			"unknown_field",
			`Unknown LSP request ${scope} field: ${unknown.join(", ")}`,
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;
	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}
