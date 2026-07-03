/**
 * Post-compaction degradation monitor.
 *
 * Watches the first POST_COMPACTION_MONITOR_COUNT assistant turns after a
 * compaction completes and triggers a single recovery compaction if the
 * model emits POST_COMPACTION_NO_TEXT_THRESHOLD consecutive assistant
 * messages with no text content (only step-start/step-finish parts).
 *
 * Algorithm ported from omo's preemptive-compaction-degradation-monitor:
 * `/Users/yeongyu/local-workspaces/omo/src/hooks/preemptive-compaction-degradation-monitor.ts`
 *
 * Pi extension surface differences vs omo:
 * - Recovery dispatch: speculative generation plus `ctx.applyCompaction(...)`
 *   instead of omo's `client.session.summarize(...)`. The "RECOVERY:" prefix
 *   in customInstructions is the disambiguator; CompactionReason stays
 *   "extension" (no new variant in v1).
 * - Notification: `ctx.notify(message)` instead of omo's
 *   `client.tui.showToast(...)`.
 *
 * Recovery cap: 1 per compaction cycle (gate via recoveryTriggeredThisCycle).
 * MAX_RECOVERY_ATTEMPTS = 3 is exported for future iteration but the v1 cycle
 * gate keeps the effective cap at 1 — recoveryAttempts is incremented only on
 * successful trigger, so once it hits 1 the cycle gate also fires regardless.
 */

export const POST_COMPACTION_MONITOR_COUNT = 5;
export const POST_COMPACTION_NO_TEXT_THRESHOLD = 3;
export const MAX_RECOVERY_ATTEMPTS = 3;

export const RECOVERY_INSTRUCTIONS = "RECOVERY: prior compaction caused degraded responses; rebuild context";
export const RECOVERY_NOTIFICATION = "Detected repeated no-text assistant responses; retried compaction recovery.";

export interface DegradationMonitorState {
	postCompactionTurnsRemaining: number;
	noTextCounter: number;
	recoveryTriggeredThisCycle: boolean;
	recoveryAttempts: number;
}

export interface DegradationMonitorContext {
	applyCompaction: (options: { customInstructions: string }) => Promise<{ applied: boolean; reason: string }>;
	notify: (message: string) => void;
}

interface MonitoredMessageContentPart {
	type: string;
	text?: string;
}

interface MonitoredMessageEvent {
	message: {
		role: string;
		content: MonitoredMessageContentPart[];
	};
}

export function createDegradationMonitorState(): DegradationMonitorState {
	return {
		postCompactionTurnsRemaining: 0,
		noTextCounter: 0,
		recoveryTriggeredThisCycle: false,
		recoveryAttempts: 0,
	};
}

/**
 * Reset the per-cycle monitor fields when a fresh compaction completes.
 * Opens a new POST_COMPACTION_MONITOR_COUNT-turn window and clears the
 * cycle-trigger gate. recoveryAttempts is preserved across cycles so the
 * MAX_RECOVERY_ATTEMPTS ceiling remains a session-wide guard.
 */
export function resetOnSessionCompact(state: DegradationMonitorState): void {
	state.postCompactionTurnsRemaining = POST_COMPACTION_MONITOR_COUNT;
	state.noTextCounter = 0;
	state.recoveryTriggeredThisCycle = false;
}

function assistantMessageHasText(event: MonitoredMessageEvent): boolean {
	if (event.message.role !== "assistant") {
		return true;
	}
	for (const part of event.message.content) {
		if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
			return true;
		}
	}
	return false;
}

export async function handleMessageEnd(
	state: DegradationMonitorState,
	event: MonitoredMessageEvent,
	context: DegradationMonitorContext,
): Promise<void> {
	if (state.postCompactionTurnsRemaining <= 0) {
		return;
	}

	if (assistantMessageHasText(event)) {
		state.noTextCounter = 0;
		return;
	}

	state.noTextCounter += 1;

	if (state.noTextCounter < POST_COMPACTION_NO_TEXT_THRESHOLD) {
		return;
	}

	if (state.recoveryTriggeredThisCycle) {
		return;
	}

	if (state.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
		return;
	}

	state.recoveryTriggeredThisCycle = true;
	state.recoveryAttempts += 1;
	state.noTextCounter = 0;

	await context.applyCompaction({ customInstructions: RECOVERY_INSTRUCTIONS });
	context.notify(RECOVERY_NOTIFICATION);
}

export function handleTurnEnd(state: DegradationMonitorState): void {
	if (state.postCompactionTurnsRemaining > 0) {
		state.postCompactionTurnsRemaining -= 1;
	}
}
