import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokens } from "../../../compaction/index.ts";
import type { BeforeAgentStartEventResult, CompactionReason } from "../../types.ts";
import { extractPatchedPaths } from "../gpt-apply-patch/index.ts";

export const POST_COMPACT_RESTORATION_CUSTOM_TYPE = "compaction.post-compact-restoration";

const POST_COMPACT_RESTORATION_SCHEMA = "senpi.compaction.post-compact-restoration.v1";
const DEFAULT_RESTORATION_MAX_ITEMS = 10;
const DEFAULT_RESTORATION_MAX_TOKENS_PER_ITEM = 5000;
const DEFAULT_RESTORATION_MAX_TOTAL_TOKENS = 50_000;
const DEFAULT_RESTORATION_CONTEXT_RATIO = 0.15;

type RestorationItemType = "file" | "skill";
type FileOperation = "read" | "write" | "edit";

export interface RestorationSettings {
	restorationMaxItems?: number;
	restorationMaxTokensPerItem?: number;
	restorationMaxTotalTokens?: number;
	restorationContextRatio?: number;
}

export interface MinimalToolCallEvent {
	toolName: string;
	input: Record<string, unknown>;
}

export interface RestorationItem {
	content: string;
	label: string;
	priority: number;
	tokens: number;
	type: RestorationItemType;
}

export interface PendingRestorationPayload {
	customType: typeof POST_COMPACT_RESTORATION_CUSTOM_TYPE;
	content: string;
	display: false;
	details: {
		schema: typeof POST_COMPACT_RESTORATION_SCHEMA;
		budgetTokens: number;
		compactionEntryId: string;
		reason: CompactionReason;
		items: RestorationItem[];
	};
	budgetTokens: number;
}

export interface PreparePendingPayloadOptions {
	accepted: boolean;
	reason: CompactionReason;
	compactionEntryId: string;
	contextWindow: number;
	usageTokens: number | null;
	reserveTokens: number;
	settings?: RestorationSettings;
	keptMessages?: AgentMessage[];
}

export interface RestorationTrackerState {
	items: Map<string, RestorationItem>;
	restoredLabels: Set<string>;
	pendingPayload: PendingRestorationPayload | null;
}

export function createRestorationTrackerState(): RestorationTrackerState {
	return {
		items: new Map(),
		restoredLabels: new Set(),
		pendingPayload: null,
	};
}

export function trackToolCall(state: RestorationTrackerState, event: MinimalToolCallEvent): void {
	switch (event.toolName) {
		case "read":
			trackPathInput(state, event.input, "read");
			return;
		case "write":
			trackPathInput(state, event.input, "write");
			return;
		case "edit":
			trackPathInput(state, event.input, "edit");
			return;
		case "apply_patch":
			trackApplyPatchInput(state, event.input);
			return;
		case "skill":
		case "load_skill":
			trackSkillInput(state, event.input);
			return;
	}
}

export function preparePendingPayload(state: RestorationTrackerState, options: PreparePendingPayloadOptions): void {
	if (!options.accepted) return;

	const budgetTokens = computeRestorationBudget(options);
	if (budgetTokens <= 0) {
		state.pendingPayload = null;
		return;
	}

	filterAgainstKeptMessages(state, options.keptMessages ?? []);
	const selectedItems = selectRestorationItems(state, options.settings, budgetTokens);
	if (selectedItems.length === 0) {
		state.pendingPayload = null;
		return;
	}

	const content = buildRestorationContent(options, selectedItems);
	state.pendingPayload = {
		customType: POST_COMPACT_RESTORATION_CUSTOM_TYPE,
		content,
		display: false,
		details: {
			schema: POST_COMPACT_RESTORATION_SCHEMA,
			budgetTokens,
			compactionEntryId: options.compactionEntryId,
			reason: options.reason,
			items: selectedItems,
		},
		budgetTokens,
	};
}

export function consumePendingPayload(
	state: RestorationTrackerState,
): BeforeAgentStartEventResult["message"] | undefined {
	const payload = state.pendingPayload;
	state.pendingPayload = null;
	if (!payload) return undefined;
	for (const item of payload.details.items) {
		state.restoredLabels.add(item.label);
	}
	return {
		customType: payload.customType,
		content: payload.content,
		display: payload.display,
		details: payload.details,
	};
}

export function computeRestorationBudget(options: PreparePendingPayloadOptions): number {
	const settings = resolveSettings(options.settings);
	const contextWindow = Math.max(0, options.contextWindow);
	const configuredBudget = settings.restorationMaxTotalTokens;
	const contextRatioBudget = Math.floor(contextWindow * settings.restorationContextRatio);
	const usageTokens = Math.max(0, options.usageTokens ?? 0);
	const remainingBudget = Math.max(0, contextWindow - usageTokens - options.reserveTokens);
	return Math.floor(Math.min(configuredBudget, contextRatioBudget, remainingBudget));
}

function trackPathInput(
	state: RestorationTrackerState,
	input: Record<string, unknown>,
	operation: FileOperation,
): void {
	if (typeof input.path !== "string" || input.path.length === 0) return;
	trackFile(state, input.path, operation);
}

function trackApplyPatchInput(state: RestorationTrackerState, input: Record<string, unknown>): void {
	if (typeof input.input !== "string") return;
	for (const path of extractPatchedPaths(input.input)) {
		if (path.length > 0) trackFile(state, path, "edit");
	}
}

function trackSkillInput(state: RestorationTrackerState, input: Record<string, unknown>): void {
	const skillName = typeof input.name === "string" ? input.name : input.skillName;
	if (typeof skillName === "string" && skillName.length > 0) {
		setItem(state, {
			content: skillName,
			label: skillName,
			priority: 80,
			tokens: estimateTextTokens(skillName),
			type: "skill",
		});
	}
}

function trackFile(state: RestorationTrackerState, path: string, operation: FileOperation): void {
	const label = path;
	const existing = state.items.get(label);
	const operations = new Set<FileOperation>(parseFileOperations(existing?.content));
	operations.add(operation);
	const content = `${path} (${sortOperations(operations).join(", ")})`;
	setItem(state, {
		content,
		label,
		priority: operation === "read" && operations.size === 1 ? 50 : 100,
		tokens: estimateTextTokens(content),
		type: "file",
	});
}

function setItem(state: RestorationTrackerState, item: RestorationItem): void {
	state.items.set(item.label, item);
}

function selectRestorationItems(
	state: RestorationTrackerState,
	settingsInput: RestorationSettings | undefined,
	budgetTokens: number,
): RestorationItem[] {
	const settings = resolveSettings(settingsInput);
	const candidates = Array.from(state.items.values())
		.filter((item) => !state.restoredLabels.has(item.label))
		.map((item) => truncateRestorationItem(item, settings.restorationMaxTokensPerItem))
		.sort((left, right) => {
			if (left.priority !== right.priority) return right.priority - left.priority;
			if (left.tokens !== right.tokens) return left.tokens - right.tokens;
			return left.label.localeCompare(right.label);
		});

	const selected: RestorationItem[] = [];
	let totalTokens = 0;
	for (const item of candidates) {
		if (selected.length >= settings.restorationMaxItems) break;
		if (totalTokens + item.tokens > budgetTokens) continue;
		selected.push(item);
		totalTokens += item.tokens;
	}
	return selected;
}

function buildRestorationContent(options: PreparePendingPayloadOptions, items: RestorationItem[]): string {
	const files = items.filter((item) => item.type === "file");
	const skills = items.filter((item) => item.type === "skill");
	const lines = [
		"[Restored context after compaction — files and skills from before compaction]",
		`reason: ${options.reason}`,
		`compactionEntryId: ${options.compactionEntryId}`,
		"",
	];

	if (files.length > 0) {
		lines.push("<restored-files>");
		for (const file of files) {
			lines.push(`<file label="${escapeXmlAttribute(file.label)}">${file.content}</file>`);
		}
		lines.push("</restored-files>");
		lines.push("");
	}

	if (skills.length > 0) {
		lines.push("<restored-skills>");
		for (const skill of skills) {
			lines.push(`<skill label="${escapeXmlAttribute(skill.label)}">${skill.content}</skill>`);
		}
		lines.push("</restored-skills>");
		lines.push("");
	}

	return lines.join("\n");
}

function truncateRestorationItem(item: RestorationItem, maxTokens: number): RestorationItem {
	if (item.tokens <= maxTokens) return item;
	const truncationNotice = "[... truncated]";
	const noticeTokens = estimateTextTokens(truncationNotice);
	const targetTokens = Math.max(0, maxTokens - noticeTokens - 1);
	const truncatedBody = truncateToTokenLimit(item.content, targetTokens);
	const content = truncatedBody.length > 0 ? `${truncatedBody}\n${truncationNotice}` : truncationNotice;
	return { ...item, content, tokens: estimateTextTokens(content) };
}

function filterAgainstKeptMessages(state: RestorationTrackerState, keptMessages: AgentMessage[]): void {
	if (keptMessages.length === 0) return;
	const keptText = keptMessages.map(extractMessageText).join("\n");
	for (const label of state.items.keys()) {
		if (keptText.includes(label)) {
			state.items.delete(label);
		}
	}
}

function extractMessageText(message: AgentMessage): string {
	if ("content" in message) {
		if (typeof message.content === "string") return message.content;
		if (Array.isArray(message.content)) {
			return message.content
				.filter((content): content is { type: "text"; text: string } => content.type === "text")
				.map((content) => content.text)
				.join("\n");
		}
	}
	if ("summary" in message) return message.summary;
	if ("command" in message) return `${message.command}\n${message.output}`;
	return "";
}

function truncateToTokenLimit(text: string, tokenLimit: number): string {
	if (tokenLimit <= 0 || text.length === 0) return "";
	if (estimateTextTokens(text) <= tokenLimit) return text;

	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		const candidate = text.slice(0, mid);
		if (estimateTextTokens(candidate) <= tokenLimit) {
			low = mid;
			continue;
		}
		high = mid - 1;
	}
	return text.slice(0, low).trimEnd();
}

function resolveSettings(settings: RestorationSettings | undefined): Required<RestorationSettings> {
	return {
		restorationMaxItems: normalizeNonNegativeInteger(settings?.restorationMaxItems, DEFAULT_RESTORATION_MAX_ITEMS),
		restorationMaxTokensPerItem: normalizeNonNegativeInteger(
			settings?.restorationMaxTokensPerItem,
			DEFAULT_RESTORATION_MAX_TOKENS_PER_ITEM,
		),
		restorationMaxTotalTokens: normalizeNonNegativeInteger(
			settings?.restorationMaxTotalTokens,
			DEFAULT_RESTORATION_MAX_TOTAL_TOKENS,
		),
		restorationContextRatio: normalizeNonNegativeNumber(
			settings?.restorationContextRatio,
			DEFAULT_RESTORATION_CONTEXT_RATIO,
		),
	};
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseFileOperations(content: string | undefined): FileOperation[] {
	if (!content) return [];
	const open = content.lastIndexOf("(");
	const close = content.lastIndexOf(")");
	if (open === -1 || close === -1 || close <= open) return [];
	return content
		.slice(open + 1, close)
		.split(",")
		.map((operation) => operation.trim())
		.filter(
			(operation): operation is FileOperation =>
				operation === "read" || operation === "write" || operation === "edit",
		);
}

function sortOperations(operations: Set<FileOperation>): FileOperation[] {
	const order: FileOperation[] = ["read", "write", "edit"];
	return order.filter((operation) => operations.has(operation));
}

function estimateTextTokens(text: string): number {
	return estimateTokens({ role: "custom", customType: "restoration", content: text, display: false, timestamp: 0 });
}

function escapeXmlAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
