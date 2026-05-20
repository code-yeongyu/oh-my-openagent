import type { PluginInput } from "@opencode-ai/plugin";

/**
 * Pattern that matches the injector's own rule banner emitted into tool
 * outputs. The capture group is the rule's path relative to project root.
 *
 * @see processFilePathForInjection in ./injector.ts where the marker is emitted.
 */
const RULE_MARKER_PATTERN = /\[Rule: ([^\]\n]+)\]\n\[Match: [^\]\n]+\]/g;

/**
 * Safety caps so transcript scanning cannot dominate a hook invocation when
 * the session has accumulated a large number of messages. The newest
 * messages are scanned first so that recent injections are detected even
 * when the cap fires.
 */
const HYDRATION_MAX_MESSAGES = 200;
const HYDRATION_MAX_CHARS = 1_000_000;

export interface TranscriptHydrationDeps {
	readonly client: PluginInput["client"];
}

export interface TranscriptHydrationStore {
	hydrateSession(sessionID: string): Promise<ReadonlySet<string>>;
	getHydratedRelativePaths(sessionID: string): ReadonlySet<string>;
	clearSession(sessionID: string): void;
}

interface SessionHydrationState {
	relativePaths: Set<string>;
	hydrated: boolean;
	inflight?: Promise<void>;
}

/**
 * Builds an in-memory store keyed by sessionID that lazily scans the session
 * transcript for `[Rule: <relativePath>]` markers and exposes the set of
 * already-injected rule relative paths. The store is consulted by the
 * injector before emitting a rule so a process that lost its persisted cache
 * file but whose model context still contains prior `[Rule: ...]` markers
 * does not re-inject duplicates.
 */
export function createTranscriptHydrationStore(
	deps: TranscriptHydrationDeps,
): TranscriptHydrationStore {
	const states = new Map<string, SessionHydrationState>();

	function ensureState(sessionID: string): SessionHydrationState {
		const existing = states.get(sessionID);
		if (existing !== undefined) {
			return existing;
		}
		const state: SessionHydrationState = {
			relativePaths: new Set(),
			hydrated: false,
		};
		states.set(sessionID, state);
		return state;
	}

	async function hydrateSession(
		sessionID: string,
	): Promise<ReadonlySet<string>> {
		const state = ensureState(sessionID);
		if (state.hydrated) {
			return state.relativePaths;
		}
		if (state.inflight === undefined) {
			state.inflight = (async () => {
				try {
					const fetched = await fetchTranscriptRelativePaths(
						deps.client,
						sessionID,
					);
					for (const relativePath of fetched) {
						state.relativePaths.add(relativePath);
					}
				} catch {
					// best-effort: a hydration failure must never block injection.
				} finally {
					state.hydrated = true;
					state.inflight = undefined;
				}
			})();
		}
		await state.inflight;
		return state.relativePaths;
	}

	function getHydratedRelativePaths(sessionID: string): ReadonlySet<string> {
		return states.get(sessionID)?.relativePaths ?? EMPTY_SET;
	}

	function clearSession(sessionID: string): void {
		states.delete(sessionID);
	}

	return { hydrateSession, getHydratedRelativePaths, clearSession };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

async function fetchTranscriptRelativePaths(
	client: PluginInput["client"],
	sessionID: string,
): Promise<Set<string>> {
	const relativePaths = new Set<string>();
	const response = (await client.session.messages({
		path: { id: sessionID },
	})) as { data?: unknown };
	const data = Array.isArray(response.data) ? response.data : [];
	const start = Math.max(0, data.length - HYDRATION_MAX_MESSAGES);
	let scannedChars = 0;
	for (let index = data.length - 1; index >= start; index -= 1) {
		const text = collectMessageText(data[index]);
		scannedChars += text.length;
		for (const match of text.matchAll(RULE_MARKER_PATTERN)) {
			const relativePath = match[1];
			if (relativePath !== undefined) {
				relativePaths.add(relativePath);
			}
		}
		if (scannedChars > HYDRATION_MAX_CHARS) {
			break;
		}
	}
	return relativePaths;
}

function collectMessageText(
	value: unknown,
	accumulator: string[] = [],
): string {
	if (typeof value === "string") {
		accumulator.push(value);
	} else if (Array.isArray(value)) {
		for (const item of value) {
			collectMessageText(item, accumulator);
		}
	} else if (value !== null && typeof value === "object") {
		for (const item of Object.values(value)) {
			collectMessageText(item, accumulator);
		}
	}
	return accumulator.join("\n");
}
