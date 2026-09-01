#!/usr/bin/env node
import registerTaskE2eMockProvider, {
	messagesContainChild,
} from "./task-e2e-mock-provider.ts";
import { startMockCompletionsServer } from "./mock-completions-server.mjs";

declare const process: {
	cwd(): string;
	getBuiltinModule<T>(id: string): T;
};

interface FsModule {
	appendFileSync(path: string, data: string): void;
	existsSync(path: string): boolean;
	readFileSync(path: string, encoding: string): string;
}

interface PathModule {
	join(...paths: string[]): string;
}

const { appendFileSync, existsSync, readFileSync } = process.getBuiltinModule<FsModule>("fs");
const { join } = process.getBuiltinModule<PathModule>("path");
const CAPTURES_FILE = "variant-thinking-captures.jsonl";
const FALLBACK_PROVIDER_ID = "omo-mock-fallback";
type TaskE2EExtensionAPI = Parameters<typeof registerTaskE2eMockProvider>[0];
type MockProvider = Parameters<TaskE2EExtensionAPI["registerProvider"]>[1];
type MockModel = MockProvider["models"][number];

// Only the sol rung is served, so momus lands on its `gpt-5.6-sol` xhigh rung and metis on its
// `gpt-5.6-sol` medium rung through cross-provider chain matching, without impersonating a builtin
// provider id (senpi merges a builtin's real baseUrl over any such registration).
type ReasoningMockModel = MockModel & { readonly thinkingLevelMap: Readonly<Record<string, string>> };

const SOL_FALLBACK_MODEL: ReasoningMockModel = {
	id: "gpt-5.6-sol",
	name: "Mock Sol",
	reasoning: true,
	thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 4096,
};

export default async function registerVariantThinkingMockProvider(
	pi: TaskE2EExtensionAPI,
): Promise<void> {
	// The curated momus/metis children run IN-PROCESS, and senpi rebuilds an in-process child request
	// from the provider config, so the applied thinking level is only observable on the wire.
	const server = startMockCompletionsServer({
		steps: () => loadChildSteps(),
		onRequest: (body: unknown) => appendCapture(body),
	});
	const baseUrl: string = await server.ready;

	const registerProvider: TaskE2EExtensionAPI["registerProvider"] = (name, provider) => {
		pi.registerProvider(name, provider);
		if (name === "omo-mock") {
			pi.registerProvider(FALLBACK_PROVIDER_ID, {
				...provider,
				name: "omo mock sol fallback provider",
				baseUrl: `${baseUrl}/v1`,
				apiKey: "mock",
				models: [SOL_FALLBACK_MODEL],
			});
		}
	};

	const interceptedApi = new Proxy(pi, {
		get(target, property, receiver) {
			if (property === "registerProvider") return registerProvider;
			return Reflect.get(target, property, receiver);
		},
	});
	registerTaskE2eMockProvider(interceptedApi);
}

function loadChildSteps(): ReadonlyArray<Record<string, unknown>> {
	const path = join(process.cwd(), "mock-script.json");
	if (!existsSync(path)) return [{ type: "text", text: "variant qa child done" }];
	const script: unknown = JSON.parse(readFileSync(path, "utf8"));
	const steps = typeof script === "object" && script !== null ? Reflect.get(script, "childSteps") : undefined;
	return Array.isArray(steps) ? steps : [{ type: "text", text: "variant qa child done" }];
}

function appendCapture(body: unknown): void {
	if (typeof body !== "object" || body === null) return;
	const messages = Reflect.get(body, "messages");
	const child = messagesContainChild({ messages: Array.isArray(messages) ? messages : [] });
	appendFileSync(
		join(process.cwd(), CAPTURES_FILE),
		`${JSON.stringify({
			child,
			model: Reflect.get(body, "model") ?? null,
			reasoning: readReasoning(body),
		})}\n`,
	);
}

function readReasoning(body: object): string | null {
	const effort = Reflect.get(body, "reasoning_effort");
	if (typeof effort === "string") return effort;
	const reasoning = Reflect.get(body, "reasoning");
	if (typeof reasoning === "string") return reasoning;
	if (typeof reasoning === "object" && reasoning !== null) {
		const nested = Reflect.get(reasoning, "effort");
		if (typeof nested === "string") return nested;
	}
	return null;
}
