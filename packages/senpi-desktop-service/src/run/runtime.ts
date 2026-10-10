import { randomUUID } from "node:crypto";
import { format } from "node:util";
import vm from "node:vm";
import type {
	AuditEvent,
	AuditRecord,
	ComputerRunOk,
	ComputerSessionSnapshot,
} from "@oh-my-opencode/senpi-desktop-protocol";
import { isRecord } from "../service/parse";
import type { DesktopService } from "../service/service";
import {
	ComputerRunError,
	type ConfirmControl,
	type EngineCall,
	type Resume,
	type RunContext,
	RunOutput,
} from "./context";
import { createDesktopFacade } from "./facade";
import { createWait, type WaitOptions } from "./wait";

/** The host's tool pipeline (senpi `executeTool`): validation, permission, and lazy activation stay host-side. */
export type ExecuteTool = (
	toolName: string,
	params: unknown,
	options: { readonly signal: AbortSignal },
) => Promise<unknown>;

export interface ComputerRunRequest {
	/** An async function body; `return` sets the run's value. */
	readonly code: string;
	readonly snapshot: ComputerSessionSnapshot;
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
}

/** `DesktopService` surface used by the run facade; `control.grant`/`revoke` stay host-only. */
export interface ComputerRunHost {
	readonly service: Pick<DesktopService, "call" | "onAudit" | "revokeControl">;
	readonly executeTool: ExecuteTool;
	/** Human confirmation behind `desktop.control.acquire`; absent: headless, never grants (#9651 B5b). */
	readonly confirmControl?: ConfirmControl;
}

const FILENAME = "computer-run.js";

/** The watchdog error is created in the run's realm, so it is no host `Error`: match its code. */
function isVmTimeout(error: unknown): boolean {
	return isRecord(error) && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
}

/** A return value detached from the run's realm: structured-cloneable as-is, else JSON, else `String`. */
function cloneSafe(value: unknown): unknown {
	if (value === undefined) return undefined;
	try {
		return structuredClone(value);
	} catch (error) {
		if (!(error instanceof DOMException)) throw error;
	}
	try {
		return JSON.parse(JSON.stringify(value) ?? "null");
	} catch (error) {
		if (!(error instanceof TypeError)) throw error;
		return String(value);
	}
}

function auditRecord(event: AuditEvent, sessionId: string, runId: string): AuditRecord {
	const { action, target, delivery, durationMs, focusRestored, textLength, textSha256, keys } = event;
	const code = event.code ?? null;
	return {
		timestamp: new Date().toISOString(),
		sessionId,
		runId,
		action,
		target,
		delivery,
		frameId: event.frameId ?? null,
		code,
		status: code === null ? "success" : code === "Suspended" ? "suspended" : "error",
		durationMs,
		...(focusRestored == null ? {} : { focusRestored }),
		...(textLength == null ? {} : { textLength }),
		...(textSha256 == null ? {} : { textSha256 }),
		...(keys == null ? {} : { keys }),
	};
}

/**
 * Runs `code` in a fresh `node:vm` context of this process, with `desktop`, `wait`, `assert`, `tool`,
 * and `console` as its globals. The vm is not a security boundary; it scopes the run's globals and
 * bounds its synchronous work.
 *
 * `microtaskMode: "afterEvaluate"` gives the context its own microtask queue, so every synchronous
 * stretch of user code (the first one and each continuation after an `await`) runs inside a
 * `runInContext` call bounded by the remaining budget: `while (true) {}` fails the run instead of
 * freezing the host. That queue is drained only by `runInContext`, so every host promise handed to the
 * code resumes the vm from a macrotask once it settles. After the run ends nothing resumes it, and
 * work it leaked stays frozen.
 */
export async function runComputerCode(request: ComputerRunRequest, host: ComputerRunHost): Promise<ComputerRunOk> {
	const { code, snapshot, timeoutMs } = request;
	const runId = randomUUID();
	const controller = new AbortController();
	const { signal } = controller;
	const deadline = Date.now() + timeoutMs;
	const fail = (reason: unknown) => controller.abort(reason);
	const timeout = () => new ComputerRunError("timeout", `computer run timed out after ${timeoutMs} ms`);
	const timer = setTimeout(() => fail(timeout()), timeoutMs);
	const onCallerAbort = () => fail(new ComputerRunError("aborted", "computer run was aborted"));
	request.signal?.addEventListener("abort", onCallerAbort, { once: true });
	if (request.signal?.aborted) onCallerAbort();
	const audit: AuditRecord[] = [];
	const unsubscribe = host.service.onAudit((event) => audit.push(auditRecord(event, snapshot.sessionId, runId)));

	const context: RunContext = {
		signal,
		readOnly: snapshot.readOnly,
		snapshot,
		output: new RunOutput(),
		screenshots: [],
		deadline,
	};
	const drain = new vm.Script("");
	const resumeVm = () => {
		if (signal.aborted) return;
		try {
			drain.runInContext(sandbox, { timeout: Math.max(1, deadline - Date.now()) });
		} catch (error) {
			fail(isVmTimeout(error) ? timeout() : error);
		}
	};
	const resume: Resume = (promise) => {
		const schedule = () => setImmediate(resumeVm);
		promise.then(schedule, schedule);
		return promise;
	};
	const call: EngineCall = (method, params) => host.service.call(method, params, { signal });
	const wait = createWait(signal, timeoutMs);
	const print = (...values: readonly unknown[]) => context.output.text(format(...values));
	const sandbox = vm.createContext(
		{
			desktop: createDesktopFacade({
				context,
				call,
				resume,
				...(host.confirmControl === undefined ? {} : { confirmControl: host.confirmControl }),
			}),
			wait: (msOrPredicate: unknown, options?: WaitOptions) => resume(wait(msOrPredicate, options)),
			assert: (condition: unknown, message?: string): void => {
				if (!condition) throw new ComputerRunError("assertion", message ?? "Assertion failed");
			},
			tool: new Proxy<Record<string, (params: unknown) => Promise<unknown>>>(
				{},
				{
					get: (_tools, name) => (params: unknown) => {
						signal.throwIfAborted();
						return resume(host.executeTool(String(name), params, { signal }));
					},
				},
			),
			console: { log: print, info: print, warn: print, error: print, debug: print },
		},
		{ name: FILENAME, microtaskMode: "afterEvaluate" },
	);

	try {
		signal.throwIfAborted();
		// The evaluation promise is marked handled inside the vm before its microtasks drain: code that throws
		// before its first await rejects it right then, ahead of the host's handler, which Node would report
		// as an unhandled rejection in the host. The rejection itself still reaches the host below unchanged.
		const script = new vm.Script(`((run) => (run.catch(() => undefined), run))((async () => {\n${code}\n})())`, {
			filename: FILENAME,
			lineOffset: -1,
		});
		const evaluation: unknown = script.runInContext(sandbox, { timeout: timeoutMs });
		const returnValue = await new Promise((resolve, reject) => {
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			signal.throwIfAborted();
			Promise.resolve(evaluation).then(resolve, reject);
			// Code that settled during the first evaluation queued this subscription on the vm's own microtask
			// queue, which only a later runInContext drains; without this drain such a run hangs to its timeout.
			setImmediate(resumeVm);
		});
		return {
			displays: context.output.finish(),
			returnValue: cloneSafe(returnValue),
			screenshots: [...context.screenshots],
			audit: [...audit],
		};
	} catch (error) {
		const failure = isVmTimeout(error) ? timeout() : error;
		// A failed run revokes the control grant (lead add (a) of #9651), so the next foreground action
		// asks the human again; an interrupted (aborted) run lands here too. The revoke is written to the
		// engine's serial queue before the run settles, so the run still settles at its own deadline, and
		// nothing sent afterwards can overtake it. Its failure goes to the service's error hub.
		void host.service.revokeControl().catch(() => undefined);
		throw failure;
	} finally {
		clearTimeout(timer);
		request.signal?.removeEventListener("abort", onCallerAbort);
		unsubscribe();
		if (!signal.aborted) controller.abort(new ComputerRunError("ended", "computer run has ended"));
	}
}
