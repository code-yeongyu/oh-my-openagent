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
const CHILD_CONTEXTS_FILE = "curated-child-contexts.jsonl";
type TaskE2EExtensionAPI = Parameters<typeof registerTaskE2eMockProvider>[0];
type MockProvider = Parameters<TaskE2EExtensionAPI["registerProvider"]>[1];
type MockModel = MockProvider["models"][number];

const EXPLORE_FALLBACK_MODEL: MockModel = {
	id: "gpt-5.4-mini-fast",
	name: "Mock Explore Fallback",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16_000,
	maxTokens: 4096,
};

export default function registerCuratedAgentsMockProvider(
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
			if (messagesContainChild(context)) {
				appendFileSync(
					join(process.cwd(), CHILD_CONTEXTS_FILE),
					`${JSON.stringify({
						prompt: JSON.stringify(context.messages ?? []),
						tools: readToolNames(context),
					})}\n`,
				);
			}
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
				name: "omo mock explore fallback provider",
				models: [EXPLORE_FALLBACK_MODEL],
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

function readToolNames(context: object): string[] {
	const tools = Reflect.get(context, "tools");
	if (!Array.isArray(tools)) return [];
	const names: string[] = [];
	for (const tool of tools) {
		if (typeof tool !== "object" || tool === null || Array.isArray(tool))
			continue;
		const name = Reflect.get(tool, "name");
		if (typeof name === "string") names.push(name);
	}
	return names;
}
