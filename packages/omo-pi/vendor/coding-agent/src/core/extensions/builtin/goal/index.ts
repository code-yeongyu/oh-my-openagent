import { createHash } from "node:crypto";
import { join } from "node:path";
import { getAgentDir } from "../../../../config.ts";
import type { ExtensionAPI, ExtensionContext } from "../../types.ts";
import { registerGoalCommand } from "./command-registration.ts";
import { shouldQueueGoalContinuationAfterAgentEnd, shouldQueueGoalContinuationWhenIdle } from "./continuation.ts";
import { formatGoalForTool, goalStatusLabel } from "./format.ts";
import { buildContinuationPrompt } from "./prompt.ts";
import { accountGoalUsage, readGoal, updateGoal } from "./store.ts";
import { registerGoalTools } from "./tool-registration.ts";
import type { Goal, GoalAccountingMode, GoalStoreRef, TokenUsageSnapshot } from "./types.ts";
import { isRecord } from "./types.ts";
import { updateGoalUi } from "./ui.ts";

const GOAL_CONTINUATION_MESSAGE_TYPE = "goal-continuation";
const RESUME_GOAL_CHOICE = "Resume goal";
const LEAVE_GOAL_PAUSED_CHOICE = "Leave paused";
const EMPTY_USAGE: TokenUsageSnapshot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
const STALE_EXTENSION_CONTEXT_ERROR_PREFIX = "This extension ctx is stale after session replacement or reload.";

type AssistantUsageMessage = {
	role: "assistant";
	usage: Record<string, unknown>;
};
type AgentGoalAccounting = {
	goalId: string;
	measuredFromMilliseconds: number;
};

export default function goalExtension(pi: ExtensionAPI): void {
	let agentTurnInProgress = false;
	let agentGoalAccounting: AgentGoalAccounting | null = null;
	let completedThisTurnGoalId: string | null = null;

	registerGoalTools(pi, {
		goalStoreRef,
		accountCurrentAgentTurn,
		beginAgentGoalAccounting,
		markGoalCompletedThisTurn,
	});
	registerGoalCommand(pi, {
		goalStoreRef,
		accountCurrentAgentTurn,
		beginAgentGoalAccounting,
		stopAgentGoalAccounting,
		clearAgentGoalAccounting,
		queueGoalContinuation,
	});

	pi.on("session_start", async (event, ctx) => {
		const goal = await readGoal(goalStoreRef(ctx));
		if (goal?.status === "active") {
			beginAgentGoalAccounting(goal);
		} else {
			clearAgentGoalAccounting();
		}
		updateGoalUi(ctx, goal);
		if (await maybePromptResumePausedGoal(pi, ctx, event.reason, goal)) {
			return;
		}
		if (shouldQueueGoalContinuationWhenIdle(goal, ctx.isIdle(), ctx.hasPendingMessages())) {
			queueHiddenGoalPrompt(pi, buildContinuationPrompt(goal));
		}
	});

	pi.on("agent_start", async (_event, ctx) => {
		agentTurnInProgress = true;
		completedThisTurnGoalId = null;
		const goal = await readGoal(goalStoreRef(ctx));
		if (goal?.status === "active") {
			beginAgentGoalAccounting(goal);
		} else {
			agentGoalAccounting = null;
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		const mode: GoalAccountingMode = completedThisTurnGoalId === null ? "active" : "activeOrComplete";
		const goal = await accountCurrentAgentTurn(ctx, collectAssistantUsage(event.messages), mode);
		agentTurnInProgress = false;
		completedThisTurnGoalId = null;
		if (goal?.status === "active") {
			beginAgentGoalAccounting(goal);
		} else {
			clearAgentGoalAccounting();
		}
		updateGoalUiBestEffort(ctx, goal);
		if (
			goal?.status === "active" &&
			shouldQueueGoalContinuationAfterAgentEnd(goal, ctx.hasPendingMessages(), event.messages)
		) {
			queueHiddenGoalPrompt(pi, buildContinuationPrompt(goal));
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (agentGoalAccounting !== null) {
			await accountCurrentAgentTurn(ctx, EMPTY_USAGE, "active");
		}
		clearAgentGoalAccounting();
	});

	async function maybePromptResumePausedGoal(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		sessionStartReason: string,
		goal: Goal | null,
	): Promise<boolean> {
		if (!isResumeOfPausedGoal(ctx, sessionStartReason, goal)) {
			return false;
		}

		const choice = await ctx.ui.select(`Resume paused goal?\nGoal: ${goal.objective}`, [
			RESUME_GOAL_CHOICE,
			LEAVE_GOAL_PAUSED_CHOICE,
		]);
		if (choice !== RESUME_GOAL_CHOICE) return true;

		const resumed = await updateGoal(goalStoreRef(ctx), { status: "active" });
		beginAgentGoalAccounting(resumed);
		updateGoalUi(ctx, resumed);
		ctx.ui.notify(`Goal ${goalStatusLabel(resumed.status)}\n${formatGoalForTool(resumed)}`, "info");
		queueGoalContinuation(pi, ctx, resumed);
		return true;
	}

	function beginAgentGoalAccounting(goal: Goal): void {
		if (goal.status !== "active") return;
		if (agentGoalAccounting?.goalId === goal.id) return;
		agentGoalAccounting = { goalId: goal.id, measuredFromMilliseconds: Date.now() };
	}

	function markGoalCompletedThisTurn(goal: Goal): void {
		if (!agentTurnInProgress) return;
		completedThisTurnGoalId = goal.id;
		agentGoalAccounting = { goalId: goal.id, measuredFromMilliseconds: Date.now() };
	}

	function stopAgentGoalAccounting(goalId: string): void {
		if (agentGoalAccounting?.goalId === goalId) {
			agentGoalAccounting = null;
		}
		if (completedThisTurnGoalId === goalId) {
			completedThisTurnGoalId = null;
		}
	}

	function clearAgentGoalAccounting(): void {
		agentGoalAccounting = null;
		completedThisTurnGoalId = null;
	}

	async function accountCurrentAgentTurn(
		ctx: ExtensionContext,
		usage: TokenUsageSnapshot,
		mode: GoalAccountingMode,
	): Promise<Goal | null> {
		const accounting = agentGoalAccounting;
		const ref = goalStoreRef(ctx);
		if (accounting === null) return readGoal(ref);

		const now = Date.now();
		const elapsedSeconds = Math.max(0, Math.round((now - accounting.measuredFromMilliseconds) / 1000));
		const goal = await accountGoalUsage(ref, usage, elapsedSeconds, mode, accounting.goalId);
		if (goal?.id === accounting.goalId) {
			agentGoalAccounting = { goalId: accounting.goalId, measuredFromMilliseconds: now };
		} else {
			clearAgentGoalAccounting();
		}
		return goal;
	}
}

function updateGoalUiBestEffort(ctx: ExtensionContext, goal: Goal | null): void {
	try {
		updateGoalUi(ctx, goal);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(STALE_EXTENSION_CONTEXT_ERROR_PREFIX)) {
			return;
		}
		throw error;
	}
}

function isResumeOfPausedGoal(ctx: ExtensionContext, sessionStartReason: string, goal: Goal | null): goal is Goal {
	return (
		sessionStartReason === "resume" &&
		goal?.status === "paused" &&
		ctx.hasUI &&
		ctx.isIdle() &&
		!ctx.hasPendingMessages()
	);
}

function queueGoalContinuation(pi: ExtensionAPI, ctx: ExtensionContext, goal: Goal): void {
	if (shouldQueueGoalContinuationWhenIdle(goal, ctx.isIdle(), ctx.hasPendingMessages())) {
		queueHiddenGoalPrompt(pi, buildContinuationPrompt(goal));
	}
}

function queueHiddenGoalPrompt(pi: ExtensionAPI, content: string): void {
	pi.sendMessage(
		{ customType: GOAL_CONTINUATION_MESSAGE_TYPE, content, display: false },
		{ triggerTurn: true, deliverAs: "followUp" },
	);
}

function goalStoreRef(ctx: ExtensionContext): GoalStoreRef {
	const sessionFile = ctx.sessionManager.getSessionFile();
	const baseDir =
		sessionFile === undefined
			? join(getAgentDir(), "extensions", "goal", "no-session", cwdStoreKey(ctx.cwd))
			: join(ctx.sessionManager.getSessionDir(), "extensions", "goal");

	return {
		baseDir,
		threadId: ctx.sessionManager.getSessionId(),
	};
}

function cwdStoreKey(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex").slice(0, 24);
}

function collectAssistantUsage(messages: unknown[]): TokenUsageSnapshot {
	const usage: TokenUsageSnapshot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
	for (const message of messages) {
		if (!isAssistantUsageMessage(message)) continue;
		usage.input += numericUsageField(message.usage, "input");
		usage.output += numericUsageField(message.usage, "output");
		usage.cacheRead += numericUsageField(message.usage, "cacheRead");
		usage.cacheWrite += numericUsageField(message.usage, "cacheWrite");
		usage.totalTokens += numericUsageField(message.usage, "totalTokens");
	}
	return usage;
}

function isAssistantUsageMessage(message: unknown): message is AssistantUsageMessage {
	if (!isRecord(message)) return false;
	return message.role === "assistant" && isRecord(message.usage);
}

function numericUsageField(usage: Record<string, unknown>, key: string): number {
	const value = usage[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
