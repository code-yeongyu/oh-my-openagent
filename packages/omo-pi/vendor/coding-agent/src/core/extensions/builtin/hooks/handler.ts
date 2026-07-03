import { diagnostic } from "./diagnostics.ts";
import { isValidHookTimeoutSeconds } from "./safety.ts";
import type {
	CommandHookConfig,
	ExecutableHookHandler,
	HookDiagnostic,
	HookSourceMetadata,
	SupportedHookEvent,
} from "./types.ts";

const UNSUPPORTED_COMMAND_FIELDS = ["if", "shell", "asyncRewake", "terminalSequence", "continueOnBlock"] as const;

type HandlerParseContext = {
	readonly event: SupportedHookEvent;
	readonly matcher?: string;
	readonly groupIndex: number;
	readonly handlerIndex: number;
	readonly source: HookSourceMetadata;
	readonly diagnostics: HookDiagnostic[];
};

export function parseHandler(handler: unknown, context: HandlerParseContext): ExecutableHookHandler | undefined {
	const path = `hooks.${context.event}[${context.groupIndex}].hooks[${context.handlerIndex}]`;
	if (!isRecord(handler)) {
		context.diagnostics.push(
			diagnostic(
				{ code: "invalid_handler", event: context.event, message: "Hook handler must be an object.", path },
				context.source,
			),
		);
		return undefined;
	}

	const type = handler.type;
	if (type !== "command") {
		context.diagnostics.push(
			diagnostic(
				{
					code: "unsupported_handler_type",
					event: context.event,
					message: 'Only type: "command" hook handlers are executable in builtin hooks v1.',
					path: `${path}.type`,
					severity: "warning",
				},
				context.source,
			),
		);
		return undefined;
	}

	if (hasUnsupportedCommandShape(handler, path, context)) {
		return undefined;
	}

	const command = handler.command;
	if (typeof command !== "string") {
		context.diagnostics.push(
			diagnostic(
				{
					code: "invalid_command",
					event: context.event,
					message: "Command hook command must be a string.",
					path: `${path}.command`,
				},
				context.source,
			),
		);
		return undefined;
	}

	const normalized = normalizeCommandConfig(handler, command, path, context);
	if (!normalized) {
		return undefined;
	}

	const base = {
		config: normalized,
		event: context.event,
		groupIndex: context.groupIndex,
		handlerIndex: context.handlerIndex,
		source: context.source,
	};
	if (context.matcher === undefined) {
		return base;
	}
	return { ...base, matcher: context.matcher };
}

function hasUnsupportedCommandShape(
	handler: Record<string, unknown>,
	path: string,
	context: HandlerParseContext,
): boolean {
	let unsupported = false;
	for (const field of UNSUPPORTED_COMMAND_FIELDS) {
		if (field in handler) {
			unsupported = true;
			context.diagnostics.push(
				diagnostic(
					{
						code: "unsupported_field",
						event: context.event,
						message: `Command hook field ${field} is not executable in builtin hooks v1.`,
						path: `${path}.${field}`,
						severity: "warning",
					},
					context.source,
				),
			);
		}
	}

	if (handler.async === true) {
		unsupported = true;
		context.diagnostics.push(
			diagnostic(
				{
					code: "unsupported_async_handler",
					event: context.event,
					message: "Async hook handlers are not executable in builtin hooks v1.",
					path: `${path}.async`,
					severity: "warning",
				},
				context.source,
			),
		);
	}

	if ("args" in handler || isRecord(handler.command)) {
		unsupported = true;
		context.diagnostics.push(
			diagnostic(
				{
					code: "unsupported_command_variant",
					event: context.event,
					message: "Exec-form command hooks are not executable in builtin hooks v1.",
					path: `${path}.command`,
					severity: "warning",
				},
				context.source,
			),
		);
	}
	return unsupported;
}

function normalizeCommandConfig(
	handler: Record<string, unknown>,
	command: string,
	path: string,
	context: HandlerParseContext,
): CommandHookConfig | undefined {
	const commandWindowsValue = handler.commandWindows ?? handler.command_windows;
	if (commandWindowsValue !== undefined && typeof commandWindowsValue !== "string") {
		context.diagnostics.push(
			diagnostic(
				{
					code: "invalid_command_windows",
					event: context.event,
					message: "commandWindows must be a string.",
					path: `${path}.commandWindows`,
				},
				context.source,
			),
		);
		return undefined;
	}

	const timeout = handler.timeout;
	if (timeout !== undefined && (typeof timeout !== "number" || !isValidHookTimeoutSeconds(timeout))) {
		context.diagnostics.push(
			diagnostic(
				{
					code: "invalid_timeout",
					event: context.event,
					message: "Command hook timeout must be a finite number greater than 0.",
					path: `${path}.timeout`,
				},
				context.source,
			),
		);
		return undefined;
	}

	const statusMessage = handler.statusMessage;
	if (statusMessage !== undefined && typeof statusMessage !== "string") {
		context.diagnostics.push(
			diagnostic(
				{
					code: "invalid_status_message",
					event: context.event,
					message: "Command hook statusMessage must be a string.",
					path: `${path}.statusMessage`,
				},
				context.source,
			),
		);
		return undefined;
	}

	return {
		type: "command",
		command,
		...(typeof commandWindowsValue === "string" ? { commandWindows: commandWindowsValue } : {}),
		...(typeof timeout === "number" ? { timeout } : {}),
		...(typeof statusMessage === "string" ? { statusMessage } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
