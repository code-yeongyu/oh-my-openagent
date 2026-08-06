import { performance } from "node:perf_hooks";
import { debuglog } from "node:util";

type DebugFieldValue = boolean | number | string | null;

type DebugFields = Record<string, DebugFieldValue>;

const debug = debuglog("codex-rules");
const noopTimer: HookDebugTimer = {
	lap: () => {},
	done: () => {},
};

export interface HookDebugTimer {
	lap(phase: string, fields?: DebugFields): void;
	done(fields?: DebugFields): void;
}

export function createHookDebugTimer(hookName: string): HookDebugTimer {
	if (!debug.enabled) {
		return noopTimer;
	}

	const startMs = performance.now();
	let lastMs = startMs;

	return {
		lap: (phase, fields = {}) => {
			const nowMs = performance.now();
			writeDebugLine(hookName, phase, nowMs - lastMs, nowMs - startMs, fields);
			lastMs = nowMs;
		},
		done: (fields = {}) => {
			const nowMs = performance.now();
			writeDebugLine(hookName, "done", nowMs - lastMs, nowMs - startMs, fields);
			lastMs = nowMs;
		},
	};
}

function writeDebugLine(
	hookName: string,
	phase: string,
	durationMs: number,
	totalMs: number,
	fields: DebugFields,
): void {
	debug(
		"%s phase=%s ms=%s total_ms=%s%s",
		hookName,
		phase,
		durationMs.toFixed(3),
		totalMs.toFixed(3),
		formatFields(fields),
	);
}

function formatFields(fields: DebugFields): string {
	const entries = Object.entries(fields);
	if (entries.length === 0) {
		return "";
	}

	return ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`;
}
