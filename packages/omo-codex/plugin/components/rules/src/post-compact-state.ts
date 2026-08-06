export type PostCompactPendingKind = "static" | "dynamic";

export interface PostCompactPendingState {
	static?: boolean;
	dynamic?: boolean;
}

export interface PostCompactStateFields {
	readonly postCompactPending?: PostCompactPendingState;
	readonly postCompactRecovering?: PostCompactPendingState;
	readonly compacted?: boolean;
}

export function postCompactKindState(kinds: ReadonlySet<PostCompactPendingKind>): PostCompactPendingState | undefined {
	if (kinds.size === 0) {
		return undefined;
	}

	return {
		...(kinds.has("static") ? { static: true } : {}),
		...(kinds.has("dynamic") ? { dynamic: true } : {}),
	};
}

export function postCompactPendingKinds(state: PostCompactStateFields): Set<PostCompactPendingKind> {
	const pendingKinds = new Set<PostCompactPendingKind>();
	if (state.compacted === true || state.postCompactPending?.static === true) {
		pendingKinds.add("static");
	}
	if (state.compacted === true || state.postCompactPending?.dynamic === true) {
		pendingKinds.add("dynamic");
	}
	return pendingKinds;
}

export function postCompactRecoveringKinds(state: PostCompactStateFields): Set<PostCompactPendingKind> {
	const recoveringKinds = new Set<PostCompactPendingKind>();
	if (state.postCompactRecovering?.static === true) {
		recoveringKinds.add("static");
	}
	if (state.postCompactRecovering?.dynamic === true) {
		recoveringKinds.add("dynamic");
	}
	return recoveringKinds;
}
