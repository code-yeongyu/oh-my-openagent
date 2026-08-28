/**
 * Tool-search discovery metadata for the thread tool family.
 *
 * The BM25 tokenizer splits camelCase and every non-alphanumeric run before
 * lowercasing, so the shared `thread` prefix carries no discriminating power:
 * ranking is decided by the verb token and the keywords. Field weights in the
 * shipped engine are name/label/alias/keyword 3, group 2, description and
 * searchText 1, which is why every label leads with its verb and the
 * user-worded phrases live in keywords. No keyword string repeats across the
 * six tools and no indexed field carries a negated-use sentence, because the
 * engine indexes negated words positively.
 */

export const THREAD_TOOL_SEARCH_GROUP = "threads"

export interface ThreadToolSearchEntry {
	/** Tool name; the verb token after `thread_` decides ranking. */
	readonly name: string
	/** UI label; indexed at name weight, so it leads with the verb. */
	readonly label: string
	/** One sentence: what the tool does plus the situation that selects it, closed by the routing clause. */
	readonly description: string
	/** Capability text indexed at description weight; never sent to the model. */
	readonly searchText: string
	/** User-worded trigger phrases, 4-6 per tool, unique across the family. */
	readonly searchKeywords: readonly string[]
	/** Catalog group shared by the whole family. */
	readonly group: typeof THREAD_TOOL_SEARCH_GROUP
	/** Search-only exposure: the tools cost zero prompt tokens until promoted. */
	readonly exposure: "search"
	/** Matches the catalog eligibility filter in the shipped ToolSearchService. */
	readonly allowLazyActivation: true
}

/** Routing clause shared by every description: a positive alternative, never a negation. */
const ROUTE_TO_TASK = "; to spawn a child task instead, use task."

export const THREAD_TOOL_SEARCH_METADATA: readonly ThreadToolSearchEntry[] = [
	{
		name: "thread_create",
		label: "Create session",
		description:
			"Starts a fresh agent session that runs alongside this one, for when the user wants a second session working in parallel" +
			ROUTE_TO_TASK,
		searchText:
			"start a second session, spin up a new conversation in parallel with the current one, work on a side project at the same time",
		searchKeywords: [
			"new parallel session",
			"second session",
			"spin up a new session",
			"open a new session",
			"work in parallel",
		],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_list",
		label: "List sessions",
		description:
			"Shows every addressable session with its id, name, and status, for when the user needs a valid target address before acting on a session" +
			ROUTE_TO_TASK,
		searchText:
			"see all my sessions, which sessions exist right now, saved sessions from earlier days, look up a session by its name",
		searchKeywords: ["saved sessions", "my sessions", "session names", "find session by name"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_read",
		label: "Read session",
		description:
			"Returns the transcript and latest output of another session, for when the user asks what another session said or produced" +
			ROUTE_TO_TASK,
		searchText:
			"check what another session said, see the output the other conversation produced, review a session transcript before deciding the next step",
		searchKeywords: ["another session output", "what another session said", "see the other session", "session transcript"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_send",
		label: "Send message to session",
		description:
			"Delivers a message into another session that is already running, for when the user wants to talk to that session mid-task" +
			ROUTE_TO_TASK,
		searchText:
			"message another session that is already running, talk to an active session while it works, tell the other session to change course",
		searchKeywords: ["message another session", "already running", "talk to that session", "reply to the other session"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_interrupt",
		label: "Interrupt session turn",
		description:
			"Stops the turn running in another session, for when the user wants to halt a session that is going down the wrong path" +
			ROUTE_TO_TASK,
		searchText:
			"stop the turn running in another session, halt that agent before it finishes, cancel the active work another session is doing",
		searchKeywords: ["stop that agent", "stop the running turn", "halt a session", "cancel the active turn"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_handoff",
		label: "Hand off session",
		description:
			"Moves the current request to an old session that has the context, for when the user says to hand this off or reopen that earlier conversation" +
			ROUTE_TO_TASK,
		searchText:
			"hand this off to the old session about the problem, reopen that old session and continue there, pass the remaining work to the previous conversation",
		searchKeywords: ["hand this off", "reopen that old session", "pass it to the previous session", "continue the old conversation"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
]

/**
 * Family policy carried by exactly one promptGuidelines entry at registration
 * time. Repeating it per tool would dilute every copy and burn six times the
 * tokens, so the per-tool entries above stay free of policy prose.
 */
export const THREAD_FAMILY_PROMPT_GUIDELINES =
	"Thread tools address peer sessions, never child tasks: call thread_list first and pass a thread_id or unique name it returned, never a guessed address; an ambiguous name returns candidates instead of delivering; leave all_scope unset to stay inside this workspace and set it only when the caller explicitly asks for sessions in every workspace."
