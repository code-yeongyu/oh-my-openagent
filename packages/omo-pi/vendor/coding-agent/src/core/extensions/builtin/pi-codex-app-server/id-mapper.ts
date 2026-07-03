import { type AdapterJsonRpcError, createAdapterJsonRpcError } from "./error-mapper.ts";

export interface RoutedRequest {
	readonly externalRequestId: string;
	readonly appMethod: string;
	readonly startedAtMs: number;
}

export interface RoutedTurn {
	readonly appTurnId: string;
	readonly appThreadId: string;
	readonly externalTurnId?: string;
	readonly externalMessageId?: string;
}

export interface RoutedItem {
	readonly appItemId: string;
	readonly appTurnId: string;
	readonly appThreadId: string;
	readonly externalItemId?: string;
	readonly itemKind: string;
}

export interface RoutedServerRequest {
	readonly appRequestId: string;
	readonly externalCallbackId: string;
	readonly appThreadId?: string;
	readonly appTurnId?: string;
	readonly appItemId?: string;
	readonly method: string;
}

export interface RegistrationResult {
	readonly kind: "registered" | "resolved";
}

export type IdMapperResult = RegistrationResult | { readonly kind: "rejected"; readonly error: AdapterJsonRpcError };

export interface IdMapper {
	registerRequest(input: RoutedRequest): IdMapperResult;
	resolveRequest(externalRequestId: string): IdMapperResult;
	getRequest(externalRequestId: string): RoutedRequest | undefined;
	registerTurn(input: RoutedTurn): IdMapperResult;
	getTurn(appTurnId: string): RoutedTurn | undefined;
	registerItem(input: RoutedItem): IdMapperResult;
	getItem(appItemId: string): RoutedItem | undefined;
	registerServerRequest(input: RoutedServerRequest): IdMapperResult;
	resolveServerRequest(appRequestId: string): IdMapperResult;
	getServerRequest(appRequestId: string): RoutedServerRequest | undefined;
}

export function createIdMapper(nowMs: () => number = Date.now): IdMapper {
	return new InMemoryIdMapper(nowMs);
}

class InMemoryIdMapper implements IdMapper {
	private readonly requests = new Map<string, RoutedRequest>();
	private readonly turns = new Map<string, RoutedTurn>();
	private readonly items = new Map<string, RoutedItem>();
	private readonly serverRequests = new Map<string, RoutedServerRequest>();
	private readonly nowMs: () => number;

	constructor(nowMs: () => number) {
		this.nowMs = nowMs;
	}

	registerRequest(input: RoutedRequest): IdMapperResult {
		if (this.requests.has(input.externalRequestId)) {
			return rejectDuplicate(`Duplicate external request id: ${input.externalRequestId}`);
		}
		this.requests.set(input.externalRequestId, {
			...input,
			startedAtMs: input.startedAtMs || this.nowMs(),
		});
		return { kind: "registered" };
	}

	resolveRequest(externalRequestId: string): IdMapperResult {
		this.requests.delete(externalRequestId);
		return { kind: "resolved" };
	}

	getRequest(externalRequestId: string): RoutedRequest | undefined {
		return this.requests.get(externalRequestId);
	}

	registerTurn(input: RoutedTurn): IdMapperResult {
		if (this.turns.has(input.appTurnId)) {
			return rejectDuplicate(`Duplicate app-server turn id: ${input.appTurnId}`);
		}
		this.turns.set(input.appTurnId, input);
		return { kind: "registered" };
	}

	getTurn(appTurnId: string): RoutedTurn | undefined {
		return this.turns.get(appTurnId);
	}

	registerItem(input: RoutedItem): IdMapperResult {
		if (this.items.has(input.appItemId)) {
			return rejectDuplicate(`Duplicate app-server item id: ${input.appItemId}`);
		}
		this.items.set(input.appItemId, input);
		return { kind: "registered" };
	}

	getItem(appItemId: string): RoutedItem | undefined {
		return this.items.get(appItemId);
	}

	registerServerRequest(input: RoutedServerRequest): IdMapperResult {
		if (this.serverRequests.has(input.appRequestId)) {
			return rejectDuplicate(`Duplicate app-server request id: ${input.appRequestId}`);
		}
		this.serverRequests.set(input.appRequestId, input);
		return { kind: "registered" };
	}

	resolveServerRequest(appRequestId: string): IdMapperResult {
		this.serverRequests.delete(appRequestId);
		return { kind: "resolved" };
	}

	getServerRequest(appRequestId: string): RoutedServerRequest | undefined {
		return this.serverRequests.get(appRequestId);
	}
}

function rejectDuplicate(message: string): IdMapperResult {
	return {
		kind: "rejected",
		error: createAdapterJsonRpcError({
			adapterCode: "duplicate-routing-id",
			message,
		}),
	};
}
