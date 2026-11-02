#!/usr/bin/env node
// Dedicated mock provider for the advisor lane. Two models ride one registration: the MAIN model
// replays a per-run script from `advisor-mock-script.json`, and the ADVISOR model answers every
// request with one fixed hint. Routing on the model id matters - the advisor child is an in-process
// session on the SAME provider, so a single global step cursor would hand the child a main-session
// step (and the hint would never be produced). Every request is appended to
// `advisor-mock-requests.jsonl`, which is how the driver proves which model each turn ran on.
import { createLocalAssistantMessageEventStream, stepToAssistantMessage, streamMockStep, type MockStep } from "./mock-provider/index.ts"

declare const process: {
	cwd(): string
	getBuiltinModule<T>(id: string): T
}

interface FsModule {
	appendFileSync(path: string, data: string): void
	existsSync(path: string): boolean
	readFileSync(path: string, encoding: string): string
}

interface PathModule {
	join(...paths: string[]): string
}

const { appendFileSync, existsSync, readFileSync } = process.getBuiltinModule<FsModule>("fs")
const { join } = process.getBuiltinModule<PathModule>("path")

export const PROVIDER_ID = "omo-mock"
export const MAIN_MODEL_ID = "mock-main"
export const ADVISOR_MODEL_ID = "mock-advisor"
export const HINT_TOKEN = "ADVISOR-HINT-7731"
export const DEFAULT_ADVISOR_HINT = `${HINT_TOKEN} The failing command is the loop: stop re-running it and read the first error line instead.`
export const SCRIPT_FILE = "advisor-mock-script.json"
export const REQUEST_LOG = "advisor-mock-requests.jsonl"

interface MockScript {
	readonly main?: { readonly steps?: readonly MockStep[]; readonly delayMs?: number }
	readonly advisor?: { readonly text?: string }
}

interface MockModel {
	id: string
	name: string
	reasoning: boolean
	input: Array<"text" | "image">
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
	contextWindow: number
	maxTokens: number
}

function mockModel(id: string, name: string): MockModel {
	return {
		id,
		name,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8192,
	}
}

// Steps the main model consumed in this process; the last step repeats forever.
let mainCursor = 0

export function loadMockScript(cwd: string): MockScript {
	const path = join(cwd, SCRIPT_FILE)
	if (!existsSync(path)) return {}
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
		return typeof parsed === "object" && parsed !== null ? (parsed as MockScript) : {}
	} catch {
		return {}
	}
}

function recordRequest(cwd: string, modelId: string, index: number): void {
	appendFileSync(join(cwd, REQUEST_LOG), `${JSON.stringify({ model: modelId, index })}\n`)
}

// The advisor child loads a task runtime and answers WHILE the main turn keeps going, so the main
// model has to stay in flight long enough for the hint to arrive and be steered in. A scripted delay
// per response is the only thing here that holds the session open without inventing tool work.
function streamStepAfter(step: MockStep, callCount: number, modelId: string, options: { signal?: AbortSignal } | undefined, delayMs: number) {
	if (delayMs <= 0) return streamMockStep(step, callCount, modelId, options)
	const stream = createLocalAssistantMessageEventStream()
	const message = stepToAssistantMessage(step, callCount, modelId)
	const timer = setTimeout(() => {
		if (options?.signal?.aborted) {
			const aborted = { ...message, stopReason: "aborted" as const }
			stream.push({ type: "error", reason: "aborted", error: aborted })
			stream.end(aborted as never)
			return
		}
		stream.push({ type: "start", partial: { ...message, content: [] } })
		if (step.type === "text") {
			stream.push({ type: "text_start", contentIndex: 0, partial: { ...message, content: [{ type: "text" as const, text: "" }] } })
			stream.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: message })
			stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: message })
		} else {
			const toolCall = message.content[0]
			stream.push({ type: "toolcall_start", contentIndex: 0, partial: { ...message, content: [{ ...toolCall, arguments: {} }] } })
			stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: message })
			stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message })
		}
		stream.push({ type: "done", reason: message.stopReason, message })
		stream.end(message as never)
	}, delayMs)
	timer.unref?.()
	return stream
}

export default function registerAdvisorMockProvider(pi: {
	registerProvider(id: string, provider: Record<string, unknown>): void
}): void {
	pi.registerProvider(PROVIDER_ID, {
		name: "advisor QA mock provider",
		baseUrl: "file://advisor-mock-provider",
		apiKey: "mock",
		api: "openai-completions",
		models: [mockModel(MAIN_MODEL_ID, "Mock Main"), mockModel(ADVISOR_MODEL_ID, "Mock Advisor")],
		streamSimple(model: { id: string }, context: { cwd?: string }, options?: { signal?: AbortSignal }) {
			const cwd = context.cwd ?? process.cwd()
			const script = loadMockScript(cwd)
			if (model.id === ADVISOR_MODEL_ID) {
				recordRequest(cwd, model.id, 0)
				const text = script.advisor?.text ?? DEFAULT_ADVISOR_HINT
				return streamMockStep({ type: "text", text }, 1, model.id, options)
			}
			const steps: readonly MockStep[] = script.main?.steps ?? [{ type: "text", text: "advisor mock provider: no script" }]
			const index = Math.min(mainCursor, steps.length - 1)
			mainCursor += 1
			recordRequest(cwd, model.id, index)
			return streamStepAfter(steps[index] as MockStep, mainCursor, model.id, options, script.main?.delayMs ?? 0)
		},
	})
}
