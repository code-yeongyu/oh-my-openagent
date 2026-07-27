#!/usr/bin/env node
// Dedicated mock provider for the fallback-architect lane: it serves TWO models so senpi's
// retry-fallback controller has a real chain to walk, and it can end the primary model's turn the
// way a classifier refusal or an Anthropic usage-policy rejection ends it.
import { createLocalAssistantMessageEventStream } from "./mock-provider/index.ts";

declare const process: {
	cwd(): string;
	getBuiltinModule<T>(id: string): T;
};

interface FsModule {
	existsSync(path: string): boolean;
	readFileSync(path: string, encoding: string): string;
}

interface PathModule {
	join(...paths: string[]): string;
}

const { existsSync, readFileSync } = process.getBuiltinModule<FsModule>("fs");
const { join } = process.getBuiltinModule<PathModule>("path");

export const PRIMARY_MODEL_ID = "claude-fable-5";
export const FALLBACK_MODEL_ID = "mock-weak";
export const POLICY_REJECTION_MESSAGE =
	"This request triggered restrictions on mock content and was blocked under Anthropic's Usage Policy";

export type PrimaryOutcome = "refusal" | "policy_error" | "transient";

interface MockModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
}

function mockModel(id: string, name: string): MockModel {
	return {
		id,
		name,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 4096,
	};
}

export function loadPrimaryOutcome(cwd: string): PrimaryOutcome {
	const path = join(cwd, "mock-script.json");
	if (!existsSync(path)) return "refusal";
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	const outcome =
		typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "primaryOutcome") : undefined;
	return outcome === "policy_error" || outcome === "transient" ? outcome : "refusal";
}

function baseMessage(modelId: string): Record<string, unknown> {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "omo-mock",
		model: modelId,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
		timestamp: Date.now(),
	};
}

export function buildPrimaryFailure(outcome: PrimaryOutcome): Record<string, unknown> {
	const message = { ...baseMessage(PRIMARY_MODEL_ID), stopReason: "error" };
	if (outcome === "refusal") return { ...message, stopDetails: { type: "refusal" }, errorMessage: "mock classifier refusal" };
	if (outcome === "policy_error") return { ...message, errorMessage: `${POLICY_REJECTION_MESSAGE}.` };
	return { ...message, errorMessage: "Request timed out." };
}

export default function registerFallbackArchitectMockProvider(pi: {
	registerProvider(id: string, provider: Record<string, unknown>): void;
}): void {
	pi.registerProvider("omo-mock", {
		name: "omo fallback-architect mock provider",
		baseUrl: "file://fallback-architect-mock-provider",
		apiKey: "mock",
		api: "openai-completions",
		models: [mockModel(PRIMARY_MODEL_ID, "Mock Fable 5"), mockModel(FALLBACK_MODEL_ID, "Mock Weak")],
		streamSimple(model: { id: string }, context: { cwd?: string }) {
			const stream = createLocalAssistantMessageEventStream();
			const cwd = context.cwd ?? process.cwd();

			queueMicrotask(() => {
				if (model.id === PRIMARY_MODEL_ID) {
					const failure = buildPrimaryFailure(loadPrimaryOutcome(cwd));
					stream.push({ type: "start", partial: failure });
					stream.push({ type: "error", reason: "error", error: failure });
					stream.end(failure as never);
					return;
				}

				const text = "fallback model answered";
				const message = { ...baseMessage(model.id), stopReason: "stop", content: [{ type: "text", text }] };
				stream.push({ type: "start", partial: { ...message, content: [] } });
				stream.push({ type: "text_start", contentIndex: 0, partial: { ...message, content: [{ type: "text", text: "" }] } });
				stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
				stream.push({ type: "done", reason: "stop", message });
				stream.end(message as never);
			});

			return stream;
		},
	});
}
