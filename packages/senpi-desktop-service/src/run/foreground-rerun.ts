import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol";
import { engineErrorCode } from "../service/global-input";
import type { EngineCall, RunOutput } from "./context";

/**
 * Automatic foreground rerun for allowed sessions (D2 of #11459, todo 24; oh-my-pi's takeover rerun,
 * worker.ts sendInput): a call the engine refused before sending anything is rerun ONCE in foreground,
 * with no prompt, only when the session already allows foreground control: full access, or a live
 * grant the human approved. Any other session gets the engine's refusal unchanged, and the confirm path
 * (`desktop.control.acquire`) stays the only way to the foreground.
 *
 * Invariants (checked exhaustively by `test/foreground-rerun-plan.test.ts`):
 * 1. At most one rerun per facade call; the rerun's own failure is final.
 * 2. A rerun happens only while foreground remains allowed, including after awaiting a grant.
 * 3. Only `BackgroundUnavailable` (nothing sent) on a foreground-capable input method, or `ControlRequired`
 *    at admission on `raiseWindow` / activating or revealing `apps.open`, triggers it; `InputFailed`, `AxUnconfirmed`, `UserIntervened`,
 *    `Cancelled`, `Suspended` and every other code never do, nor does a cancelled run.
 * 4. A call whose delivery the caller set explicitly is never rerun.
 * 5. An eligible plan requests an automatic grant only when no grant may be live. A later cancellation
 *    or permission loss can still prevent the rerun; a live human grant is reused without a new grant.
 * 6. `ax.perform`, `ax.setValue`, `ax.focus` and `ax.selectText` are never rerun.
 */

/** Trigger (i): input the engine could not deliver in background; the rerun asks for foreground delivery. */
const FOREGROUND_INPUT: ReadonlySet<string> = new Set([
	"click",
	"drag",
	"scroll",
	"typeText",
	"keyChord",
	"holdKeys",
	"holdMouse",
	"ax.click",
	"ax.typeText",
	"ax.keyChord",
]);

/**
 * Trigger (ii, Q5): methods that take the foreground themselves and need the grant at admission; rerun unchanged.
 * `apps.open` (activate/reveal) is W2's method (#11717/#11719, plan todo 11): listed so it reruns once that stack merges.
 */
const TAKES_FOREGROUND: ReadonlySet<string> = new Set(["raiseWindow", "apps.open"]);

export type RerunTrigger = "backgroundUnavailable" | "controlRequired";

export interface RerunState {
	/** Full access, or a live grant the human approved (never an automatic one). */
	readonly foregroundAllowed: boolean;
	/** A grant this service sent may still hold (human or automatic). */
	readonly possiblyLive: boolean;
	readonly cancelled: boolean;
}

export interface RerunPlan {
	readonly trigger: RerunTrigger;
	/** Acquire the automatic full-access grant before the rerun. */
	readonly grantFirst: boolean;
	readonly params: object;
}

function deliverySetExplicitly(params: object): boolean {
	const opts: unknown = Reflect.get(params, "opts");
	return typeof opts === "object" && opts !== null && Reflect.get(opts, "deliveryMode") !== undefined;
}

function withForegroundDelivery(params: object): object {
	const opts: unknown = Reflect.get(params, "opts");
	const current = typeof opts === "object" && opts !== null ? opts : {};
	return { ...params, opts: { ...current, deliveryMode: "foreground" } };
}

/** The pure decision: whether and how `method`'s refusal `error` is rerun under `state`. */
export function planRerun(method: EngineMethod, params: object, error: unknown, state: RerunState): RerunPlan | undefined {
	if (state.cancelled || !state.foregroundAllowed) return undefined;
	const code = engineErrorCode(error);
	if (code === "BackgroundUnavailable" && FOREGROUND_INPUT.has(method) && !deliverySetExplicitly(params)) {
		return { trigger: "backgroundUnavailable", grantFirst: !state.possiblyLive, params: withForegroundDelivery(params) };
	}
	if (code === "ControlRequired" && TAKES_FOREGROUND.has(method)
		&& (method === "raiseWindow" || Reflect.get(params, "activate") === true || Reflect.get(params, "reveal") === true)) {
		return { trigger: "controlRequired", grantFirst: !state.possiblyLive, params };
	}
	return undefined;
}

/** What the wrapper needs from the service: the live state reads and the automatic grant. */
export interface ForegroundRerunHost {
	foregroundAllowed(): boolean;
	possiblyLive(): boolean;
	/** The automatic full-access grant; false (nothing granted) once the session left full access. */
	grantForFullAccess(signal: AbortSignal): Promise<boolean>;
}

const REASON: Record<RerunTrigger, string> = {
	backgroundUnavailable: "the window could not take this input in the background",
	controlRequired: "raising a window takes the foreground",
};

/**
 * Wraps the run's engine channel: every refusal `planRerun` accepts is rerun once, after the automatic
 * grant when none may be live, and the run output gets one line saying it ran in foreground. The engine's
 * audit of the rerun already records `delivery: foreground`, so no new field is added.
 */
export function withForegroundRerun(call: EngineCall, host: ForegroundRerunHost, output: RunOutput, signal: AbortSignal): EngineCall {
	return async (method, params) => {
		try {
			return await call(method, params);
		} catch (error) {
			const plan = planRerun(method, params, error, {
				foregroundAllowed: host.foregroundAllowed(),
				possiblyLive: host.possiblyLive(),
				cancelled: signal.aborted,
			});
			if (plan === undefined) throw error;
			// A session that left full access between the decision and the grant no longer allows
			// the foreground: it gets the engine's own refusal, unchanged (nothing granted or sent).
			if (plan.grantFirst && !(await host.grantForFullAccess(signal))) throw error;
			if (signal.aborted || !host.foregroundAllowed()) throw error;
			const result = await call(method, plan.params);
			output.text(`ran in foreground: ${REASON[plan.trigger]} (the session allows foreground control)`);
			return result;
		}
	};
}
