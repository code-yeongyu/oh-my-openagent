import { type AdapterJsonRpcError, createAdapterJsonRpcError } from "./error-mapper.ts";

export interface SessionBindingInput {
	readonly externalSessionId: string;
	readonly appThreadId: string;
	readonly appSessionId: string;
}

export interface ReplayCursor {
	readonly lastCompletedTurnId?: string;
	readonly lastProjectedItemId?: string;
	readonly lastLosslessSequence?: number;
}

export interface SessionBinding {
	readonly externalSessionId: string;
	readonly appThreadId: string;
	readonly appSessionId: string;
	readonly tombstoned: boolean;
	readonly replayCursor: ReplayCursor;
}

export type SessionBindResult =
	| { readonly kind: "bound"; readonly binding: SessionBinding }
	| { readonly kind: "rejected"; readonly error: AdapterJsonRpcError };

export type SessionLookupResult =
	| { readonly kind: "active"; readonly binding: SessionBinding }
	| { readonly kind: "rejected"; readonly error: AdapterJsonRpcError };

export interface SessionRegistry {
	bindSession(input: SessionBindingInput): SessionBindResult;
	getByExternalSessionId(externalSessionId: string): SessionBinding | undefined;
	getByAppThreadId(appThreadId: string): SessionBinding | undefined;
	requireActiveSession(externalSessionId: string): SessionLookupResult;
	tombstoneExternalSession(externalSessionId: string): SessionLookupResult;
	updateReplayCursor(externalSessionId: string, replayCursor: ReplayCursor): SessionLookupResult;
}

export function createSessionRegistry(): SessionRegistry {
	return new InMemorySessionRegistry();
}

class InMemorySessionRegistry implements SessionRegistry {
	private readonly byExternalSessionId = new Map<string, SessionBinding>();
	private readonly externalSessionIdByAppThreadId = new Map<string, string>();

	bindSession(input: SessionBindingInput): SessionBindResult {
		if (this.byExternalSessionId.has(input.externalSessionId)) {
			return rejectDuplicate(`Duplicate external session id: ${input.externalSessionId}`);
		}
		const existingExternalSessionId = this.externalSessionIdByAppThreadId.get(input.appThreadId);
		if (existingExternalSessionId && existingExternalSessionId !== input.externalSessionId) {
			return rejectDuplicate(`Duplicate app-server thread id: ${input.appThreadId}`);
		}
		const binding: SessionBinding = {
			externalSessionId: input.externalSessionId,
			appThreadId: input.appThreadId,
			appSessionId: input.appSessionId,
			tombstoned: false,
			replayCursor: {},
		};
		this.byExternalSessionId.set(binding.externalSessionId, binding);
		this.externalSessionIdByAppThreadId.set(binding.appThreadId, binding.externalSessionId);
		return { kind: "bound", binding };
	}

	getByExternalSessionId(externalSessionId: string): SessionBinding | undefined {
		return this.byExternalSessionId.get(externalSessionId);
	}

	getByAppThreadId(appThreadId: string): SessionBinding | undefined {
		const externalSessionId = this.externalSessionIdByAppThreadId.get(appThreadId);
		if (!externalSessionId) return undefined;
		return this.byExternalSessionId.get(externalSessionId);
	}

	requireActiveSession(externalSessionId: string): SessionLookupResult {
		const binding = this.byExternalSessionId.get(externalSessionId);
		if (!binding) {
			return rejectSession(`Unknown external session: ${externalSessionId}`);
		}
		if (binding.tombstoned) {
			return rejectSession(`External session is tombstoned: ${externalSessionId}`);
		}
		return { kind: "active", binding };
	}

	tombstoneExternalSession(externalSessionId: string): SessionLookupResult {
		const lookup = this.requireActiveSession(externalSessionId);
		if (lookup.kind === "rejected") return lookup;
		const tombstoned: SessionBinding = {
			...lookup.binding,
			tombstoned: true,
		};
		this.byExternalSessionId.set(externalSessionId, tombstoned);
		return { kind: "active", binding: tombstoned };
	}

	updateReplayCursor(externalSessionId: string, replayCursor: ReplayCursor): SessionLookupResult {
		const lookup = this.requireActiveSession(externalSessionId);
		if (lookup.kind === "rejected") return lookup;
		const updated: SessionBinding = {
			...lookup.binding,
			replayCursor,
		};
		this.byExternalSessionId.set(externalSessionId, updated);
		return { kind: "active", binding: updated };
	}
}

function rejectSession(message: string): SessionLookupResult {
	return {
		kind: "rejected",
		error: createAdapterJsonRpcError({
			adapterCode: "invalid-session-state",
			message,
		}),
	};
}

function rejectDuplicate(message: string): SessionBindResult {
	return {
		kind: "rejected",
		error: createAdapterJsonRpcError({
			adapterCode: "duplicate-routing-id",
			message,
		}),
	};
}
