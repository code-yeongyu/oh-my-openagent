#!/usr/bin/env node
import registerTaskE2eMockProvider, {
	messagesContainChild,
} from "./task-e2e-mock-provider.ts";

declare const process: {
	cwd(): string;
	getBuiltinModule<T>(id: string): T;
};

interface FsModule {
	appendFileSync(path: string, data: string): void;
}

interface PathModule {
	join(...paths: string[]): string;
}

const { appendFileSync } = process.getBuiltinModule<FsModule>("fs");
const { join } = process.getBuiltinModule<PathModule>("path");
const CAPTURES_FILE = "variant-thinking-captures.jsonl";
type TaskE2EExtensionAPI = Parameters<typeof registerTaskE2eMockProvider>[0];
type MockProvider = Parameters<TaskE2EExtensionAPI["registerProvider"]>[1];
type MockModel = MockProvider["models"][number];

const OPUS_FALLBACK_MODEL: MockModel = {
	id: "claude-opus-4-8",
	name: "Mock Opus",
	reasoning: true,
	thinkingLevelMap: { xhigh: "xhigh", max: "max" },
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16_000,
	maxTokens: 4096,
};

const SOL_FALLBACK_MODEL: MockModel = {
	id: "gpt-5.6-sol",
	name: "Mock Sol",
	reasoning: true,
	thinkingLevelMap: { xhigh: "xhigh", max: "max" },
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16_000,
	maxTokens: 4096,
};

export default function registerVariantThinkingMockProvider(
	pi: TaskE2EExtensionAPI,
): void {
	const registerProvider: TaskE2EExtensionAPI["registerProvider"] = (
		name,
		provider,
	) => {
		const wrappedStream: MockProvider["streamSimple"] = (
			model,
			context,
			options,
		) => {
			appendFileSync(
				join(process.cwd(), CAPTURES_FILE),
				`${JSON.stringify({
					child: messagesContainChild(context),
					model: Reflect.get(model, "id"),
					reasoning: readReasoning(options),
				})}\n`,
			);
			return provider.streamSimple(model, context, options);
		};
		const wrappedProvider: MockProvider = {
			...provider,
			streamSimple: wrappedStream,
		};
		pi.registerProvider(name, wrappedProvider);
		if (name === "omo-mock") {
			pi.registerProvider("openai", {
				...wrappedProvider,
				name: "omo mock sol fallback provider",
				models: [SOL_FALLBACK_MODEL],
			});
			pi.registerProvider("anthropic", {
				...wrappedProvider,
				name: "omo mock opus fallback provider",
				models: [OPUS_FALLBACK_MODEL],
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

function readReasoning(options: unknown): string | null {
	if (typeof options !== "object" || options === null) return null;
	const reasoning = Reflect.get(options, "reasoning");
	return typeof reasoning === "string" ? reasoning : null;
}
