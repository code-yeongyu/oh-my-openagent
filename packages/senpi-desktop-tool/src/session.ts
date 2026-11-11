import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputerSessionSnapshot } from "@oh-my-opencode/senpi-desktop-protocol";
import type { DesktopSessionOpenParams } from "@oh-my-opencode/senpi-desktop-service";
import type { ComputerSettings } from "./settings";

/** The fields of the host's active model (`@earendil-works/pi-ai` `Model`) the capture policy reads. */
export interface ComputerModel {
	readonly id: string;
	readonly provider: string;
	readonly api: string;
	readonly compat?: unknown;
}

/** The capture policy sent with a hand's call, decided where the loop's model is (brain/hand split). */
export interface ComputerCapturePolicy {
	readonly coordinateSafe: boolean;
	readonly maxWidth: number;
	readonly maxHeight: number;
	readonly maxBytes: number;
	readonly screenshotGc: { readonly staleMs: number; readonly scanIntervalMs: number };
}

/** The execution scope a hand runs the call in: it owns the audit file and the capture policy there. */
export interface ComputerExecutionScope {
	/** The calling session's id, stamped on audit records; the hand routes with it and never interprets it. */
	readonly sessionId: string;
	/** The scope owner's runtime audit directory on this device. */
	readonly auditDir: string;
	readonly capture: ComputerCapturePolicy;
}

/** What the host knows about the agent session; a structural subset of coding-agent's `ExtensionContext`. */
export interface ComputerHostContext {
	readonly cwd: string;
	readonly model: ComputerModel | undefined;
	readonly sessionManager: { getSessionId(): string; getSessionDir(): string };
	/** False on headless hosts; the foreground-control confirm never prompts (#9651 B5b). */
	readonly hasUI?: boolean;
	/** Structural slice of the host's tool-call UI; only `confirm` is used, for `control.acquire`. */
	readonly ui?: {
		notify?(message: string, level: "info" | "warning" | "error"): void;
		confirm?(title: string, body: string, options?: { signal?: AbortSignal; timeout?: number }): Promise<boolean>;
	};
	/** Set on a hand: `sessionManager` and `model` are then never read (the hand has no transcript or model). */
	readonly executionScope?: ComputerExecutionScope;
}

export const AUDIT_FILE_NAME = ".computer-audit.jsonl";

/** With screenshot GC off nothing may ever count as stale; the engine has no separate off switch. */
const GC_NEVER_STALE_MS = Number.MAX_SAFE_INTEGER;

/**
 * Whether the model clicks in the pixels it was shown after a transport resize it cannot see (port of
 * oh-my-pi `usesCoordinateSafeImageSizing`). The engine then clamps captures to its coordinate-safe size.
 * senpi has no model-class classifier, so the Claude family is recognized by API, provider, or model id.
 */
export function usesCoordinateSafeImageSizing(model: ComputerModel | undefined): boolean {
	if (model === undefined) return false;
	const { compat } = model;
	if (typeof compat === "object" && compat !== null && "supportsImageDetailOriginal" in compat) {
		if (compat.supportsImageDetailOriginal === false) return true;
	}
	return model.api === "anthropic-messages" || model.provider === "anthropic" || /claude/i.test(model.id);
}

/** `session.open` params from the settings, the active model, and the session directory. */
export function sessionOpenParams(settings: ComputerSettings, context: ComputerHostContext): DesktopSessionOpenParams {
	const { auditLog, screenshotGc } = settings;
	const scope = context.executionScope;
	if (scope !== undefined) {
		const { capture } = scope;
		return {
			display: settings.display,
			macosCanary: settings.macosCanary,
			showCursor: settings.showCursor,
			allowHostRelayOnlyStop: settings.allowHostRelayOnlyStop,
			auditPath: auditLog.enabled ? join(scope.auditDir, AUDIT_FILE_NAME) : null,
			artifactDir: tmpdir(),
			screenshotGc: { staleMs: capture.screenshotGc.staleMs, scanIntervalMs: capture.screenshotGc.scanIntervalMs },
			captureCaps: {
				maxWidth: capture.maxWidth,
				maxHeight: capture.maxHeight,
				coordinateSafe: capture.coordinateSafe,
				maxBytes: capture.maxBytes,
			},
		};
	}
	return {
		display: settings.display,
		macosCanary: settings.macosCanary,
		showCursor: settings.showCursor,
		allowHostRelayOnlyStop: settings.allowHostRelayOnlyStop,
		auditPath: auditLog.enabled ? join(context.sessionManager.getSessionDir(), AUDIT_FILE_NAME) : null,
		artifactDir: tmpdir(),
		screenshotGc: {
			staleMs: screenshotGc.enabled ? screenshotGc.staleMs : GC_NEVER_STALE_MS,
			scanIntervalMs: screenshotGc.scanIntervalMs,
		},
		captureCaps: {
			maxWidth: settings.maxWidth,
			maxHeight: settings.maxHeight,
			coordinateSafe: usesCoordinateSafeImageSizing(context.model),
			maxBytes: settings.screenshotMaxBytes,
		},
		// The service sends each of these only to an engine that advertises its feature.
		intervention: settings.intervention,
		macosKeyPriming: settings.macosKeyPriming,
		trace: settings.trace,
	};
}

/** The frozen per-run settings `runComputerCode` hands to the facade. */
export function runSnapshot(
	settings: ComputerSettings,
	context: ComputerHostContext,
	readOnly: boolean,
): ComputerSessionSnapshot {
	const scope = context.executionScope;
	return {
		cwd: context.cwd,
		sessionId: scope === undefined ? context.sessionManager.getSessionId() : scope.sessionId,
		captureMaxWidth: scope === undefined ? settings.maxWidth : scope.capture.maxWidth,
		captureMaxHeight: scope === undefined ? settings.maxHeight : scope.capture.maxHeight,
		captureMaxBytes: scope === undefined ? settings.screenshotMaxBytes : scope.capture.maxBytes,
		display: settings.display,
		readOnly,
		stopHotkey: settings.stopHotkey,
		allowHostRelayOnlyStop: settings.allowHostRelayOnlyStop,
	};
}
