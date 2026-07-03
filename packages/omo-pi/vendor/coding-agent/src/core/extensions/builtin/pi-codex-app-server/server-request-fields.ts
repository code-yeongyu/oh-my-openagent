import type { OpaqueAppServerEnvelope } from "./notification-projector.ts";
import { classifyAppServerSurface, PI_CODEX_APP_SERVER_PROTOCOL_VERSION } from "./protocol-core.ts";
import type { SessionRegistry } from "./session-registry.ts";

export interface AppServerRequestIds {
	readonly appThreadId: string | undefined;
	readonly appTurnId: string | undefined;
	readonly appItemId: string | undefined;
}

export interface OpaqueServerRequestEnvelopeInput {
	readonly connectionId: string;
	readonly capabilityFlags: readonly string[];
	readonly externalCallbackId: string;
	readonly appRequestId: string;
	readonly method: string;
	readonly params: unknown;
	readonly ids: AppServerRequestIds;
	readonly sequence: number;
	readonly sessionRegistry: SessionRegistry;
}

export function readAppServerRequestIds(params: unknown): AppServerRequestIds {
	const record = isRecord(params) ? params : {};
	return {
		appThreadId: readString(record, "threadId") ?? readString(record, "thread_id"),
		appTurnId: readString(record, "turnId") ?? readString(record, "turn_id"),
		appItemId: readString(record, "itemId") ?? readString(record, "item_id"),
	};
}

export function readRequestId(params: unknown): string | undefined {
	if (!isRecord(params)) return undefined;
	const value = params.requestId ?? params.request_id ?? params.id;
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return undefined;
}

export function readSecretQuestionIds(params: unknown): ReadonlySet<string> {
	if (!isRecord(params) || !Array.isArray(params.questions)) return new Set();
	const ids: string[] = [];
	for (const question of params.questions) {
		if (!isRecord(question)) continue;
		if (question.isSecret !== true && question.is_secret !== true) continue;
		const id = readString(question, "id");
		if (id) ids.push(id);
	}
	return new Set(ids);
}

export function redactSecretAnswers(response: unknown, secretQuestionIds: ReadonlySet<string>): unknown {
	if (secretQuestionIds.size === 0 || !isRecord(response)) return response;
	const answers = response.answers;
	if (!isRecord(answers)) return response;
	const redactedAnswers: Record<string, unknown> = {};
	for (const [questionId, answer] of Object.entries(answers)) {
		redactedAnswers[questionId] = secretQuestionIds.has(questionId) ? redactAnswer(answer) : answer;
	}
	return { ...response, answers: redactedAnswers };
}

export function createOpaqueServerRequestEnvelope(input: OpaqueServerRequestEnvelopeInput): OpaqueAppServerEnvelope {
	const binding = input.ids.appThreadId ? input.sessionRegistry.getByAppThreadId(input.ids.appThreadId) : undefined;
	return {
		protocolVersion: PI_CODEX_APP_SERVER_PROTOCOL_VERSION,
		connectionId: input.connectionId,
		externalSessionId: binding?.externalSessionId,
		externalRequestId: undefined,
		externalMessageId: undefined,
		externalCallbackId: input.externalCallbackId,
		appThreadId: input.ids.appThreadId,
		appSessionId: binding?.appSessionId,
		appTurnId: input.ids.appTurnId,
		appItemId: input.ids.appItemId,
		appRequestId: input.appRequestId,
		sequence: input.sequence,
		streamClass: classifyAppServerSurface(input.method)?.streamClass ?? "lossless",
		capabilityFlags: input.capabilityFlags,
		originalMethod: input.method,
		originalParams: input.params,
		redactionClass: readSecretQuestionIds(input.params).size > 0 ? "secret-bearing" : "public-contract",
	};
}

function redactAnswer(answer: unknown): unknown {
	if (!isRecord(answer) || !Array.isArray(answer.answers)) return answer;
	return { ...answer, answers: answer.answers.map(() => "[REDACTED]") };
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
