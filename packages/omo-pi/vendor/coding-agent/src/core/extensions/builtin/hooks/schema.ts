import { diagnostic } from "./diagnostics.ts";
import { parseHandler } from "./handler.ts";
import type {
	ExecutableHookHandler,
	HookDiagnostic,
	HookSourceMetadata,
	ParsedHookConfig,
	SupportedHookEvent,
} from "./types.ts";
import { SUPPORTED_HOOK_EVENTS, UNSUPPORTED_KNOWN_HOOK_EVENTS } from "./types.ts";

const SUPPORTED_EVENT_SET = new Set<string>(SUPPORTED_HOOK_EVENTS);
const UNSUPPORTED_EVENT_SET = new Set<string>(UNSUPPORTED_KNOWN_HOOK_EVENTS);

export function parseHookConfig(input: unknown, source: HookSourceMetadata): ParsedHookConfig {
	const diagnostics: HookDiagnostic[] = [];
	const executableHandlers: ExecutableHookHandler[] = [];

	if (!isRecord(input)) {
		diagnostics.push(
			diagnostic({ code: "invalid_root", message: "Hook config must be an object.", path: "$" }, source),
		);
		return { executableHandlers, diagnostics };
	}

	const hooks = input.hooks;
	if (!isRecord(hooks)) {
		diagnostics.push(
			diagnostic(
				{ code: "invalid_hooks", message: "Hook config must contain an object hooks field.", path: "hooks" },
				source,
			),
		);
		return { executableHandlers, diagnostics };
	}

	for (const [eventName, groups] of Object.entries(hooks)) {
		if (isSupportedHookEvent(eventName)) {
			executableHandlers.push(...parseSupportedEvent(eventName, groups, source, diagnostics));
			continue;
		}
		diagnostics.push(
			diagnostic(
				{
					code: isUnsupportedKnownHookEvent(eventName) ? "unsupported_event" : "unknown_event",
					event: eventName,
					message: `Hook event ${eventName} is not executable in builtin hooks v1.`,
					path: `hooks.${eventName}`,
					severity: "warning",
				},
				source,
			),
		);
	}

	return { executableHandlers, diagnostics };
}

function parseSupportedEvent(
	event: SupportedHookEvent,
	groups: unknown,
	source: HookSourceMetadata,
	diagnostics: HookDiagnostic[],
): ExecutableHookHandler[] {
	if (!Array.isArray(groups)) {
		diagnostics.push(
			diagnostic(
				{
					code: "invalid_event_config",
					event,
					message: "Hook event entries must be an array.",
					path: `hooks.${event}`,
				},
				source,
			),
		);
		return [];
	}

	const handlers: ExecutableHookHandler[] = [];
	for (const [groupIndex, group] of groups.entries()) {
		const groupPath = `hooks.${event}[${groupIndex}]`;
		if (!isRecord(group)) {
			diagnostics.push(
				diagnostic(
					{
						code: "invalid_handler_group",
						event,
						message: "Hook matcher group must be an object.",
						path: groupPath,
					},
					source,
				),
			);
			continue;
		}

		const matcher = parseMatcher(group.matcher, groupPath, event, source, diagnostics);
		const hookList = group.hooks;
		if (!Array.isArray(hookList)) {
			diagnostics.push(
				diagnostic(
					{
						code: "invalid_handler_list",
						event,
						message: "Hook matcher group hooks must be an array.",
						path: `${groupPath}.hooks`,
					},
					source,
				),
			);
			continue;
		}

		for (const [handlerIndex, handler] of hookList.entries()) {
			const parsed = parseHandler(handler, { event, matcher, groupIndex, handlerIndex, source, diagnostics });
			if (parsed) {
				handlers.push(parsed);
			}
		}
	}
	return handlers;
}

function parseMatcher(
	value: unknown,
	groupPath: string,
	event: SupportedHookEvent,
	source: HookSourceMetadata,
	diagnostics: HookDiagnostic[],
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "string") {
		return value;
	}
	diagnostics.push(
		diagnostic(
			{ code: "invalid_matcher", event, message: "Hook matcher must be a string.", path: `${groupPath}.matcher` },
			source,
		),
	);
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedHookEvent(value: string): value is SupportedHookEvent {
	return SUPPORTED_EVENT_SET.has(value);
}

function isUnsupportedKnownHookEvent(value: string): boolean {
	return UNSUPPORTED_EVENT_SET.has(value);
}
