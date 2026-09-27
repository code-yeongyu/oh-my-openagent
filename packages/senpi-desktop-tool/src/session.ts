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

/** What the host knows about the agent session; a structural subset of coding-agent's `ExtensionContext`. */
export interface ComputerHostContext {
	readonly cwd: string;
	readonly model: ComputerModel | undefined;
	readonly sessionManager: { getSessionId(): string; getSessionDir(): string };
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
	return {
		display: settings.display,
		macosCanary: settings.macosCanary,
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
	};
}

/** The frozen per-run settings `runComputerCode` hands to the facade. */
export function runSnapshot(
	settings: ComputerSettings,
	context: ComputerHostContext,
	readOnly: boolean,
): ComputerSessionSnapshot {
	return {
		cwd: context.cwd,
		sessionId: context.sessionManager.getSessionId(),
		captureMaxWidth: settings.maxWidth,
		captureMaxHeight: settings.maxHeight,
		captureMaxBytes: settings.screenshotMaxBytes,
		display: settings.display,
		readOnly,
		stopHotkey: settings.stopHotkey,
		allowHostRelayOnlyStop: settings.allowHostRelayOnlyStop,
	};
}
