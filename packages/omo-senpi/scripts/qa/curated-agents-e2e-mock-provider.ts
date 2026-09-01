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
const CHILD_CONTEXTS_FILE = "curated-child-contexts.jsonl";
const FALLBACK_PROVIDER_ID = "omo-mock-fallback";
type TaskE2EExtensionAPI = Parameters<typeof registerTaskE2eMockProvider>[0];
type MockProvider = Parameters<TaskE2EExtensionAPI["registerProvider"]>[1];
type MockModel = MockProvider["models"][number];

const EXPLORE_FALLBACK_MODEL: MockModel = {
	id: "gpt-5.6-luna-fast",
	name: "Mock Explore Fallback",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 4096,
};

export default async function registerCuratedAgentsMockProvider(
	pi: TaskE2EExtensionAPI,
): Promise<void> {
	// The curated explore child runs IN-PROCESS, and senpi rebuilds an in-process child request from the
	// provider config (a config without `baseUrl` is rejected outright), so the child never reaches an
	// extension `streamSimple`. Serving the fallback model from 127.0.0.1 is what makes the child path
	// observable and offline; the request body is also the only place its prompt and tools appear.
	const server = startMockCompletionsServer({
		steps: () => loadChildSteps(),
		onRequest: (body: unknown) => appendChildContext(body),
	});
	const baseUrl: string = await server.ready;

	const registerProvider: TaskE2EExtensionAPI["registerProvider"] = (
		name,
		provider,
	) => {
		const wrappedStream: MockProvider["streamSimple"] = (
			model,
			context,
			options,
		) => provider.streamSimple(model, context, options);
		pi.registerProvider(name, { ...provider, streamSimple: wrappedStream });
		if (name === "omo-mock") {
			pi.registerProvider(FALLBACK_PROVIDER_ID, {
				...provider,
				name: "omo mock explore fallback provider",
				baseUrl: `${baseUrl}/v1`,
				apiKey: "mock",
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

function loadChildSteps(): ReadonlyArray<Record<string, unknown>> {
	const path = join(process.cwd(), "mock-script.json");
	if (!existsSync(path)) return [{ type: "text", text: "child done" }];
	const script: unknown = JSON.parse(readFileSync(path, "utf8"));
	const steps = typeof script === "object" && script !== null ? Reflect.get(script, "childSteps") : undefined;
	return Array.isArray(steps) ? steps : [{ type: "text", text: "child done" }];
}

function appendChildContext(body: unknown): void {
	if (typeof body !== "object" || body === null) return;
	const messages = Reflect.get(body, "messages");
	if (!messagesContainChild({ messages: Array.isArray(messages) ? messages : [] })) return;
	appendFileSync(
		join(process.cwd(), CHILD_CONTEXTS_FILE),
		`${JSON.stringify({ prompt: JSON.stringify(messages ?? []), tools: readToolNames(body) })}\n`,
	);
}

function readToolNames(body: object): string[] {
	const tools = Reflect.get(body, "tools");
	if (!Array.isArray(tools)) return [];
	const names: string[] = [];
	for (const tool of tools) {
		if (typeof tool !== "object" || tool === null || Array.isArray(tool)) continue;
		const fn = Reflect.get(tool, "function");
		const name = typeof fn === "object" && fn !== null ? Reflect.get(fn, "name") : Reflect.get(tool, "name");
		if (typeof name === "string") names.push(name);
	}
	return names;
}
