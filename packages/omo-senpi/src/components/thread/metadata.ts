/**
 * Tool-search discovery metadata for the thread tool family.
 *
 * The BM25 tokenizer splits camelCase and every non-alphanumeric run before
 * lowercasing, so the shared `thread` prefix carries no discriminating power:
 * ranking is decided by the verb token and the keywords. Field weights in the
 * shipped engine are name/label/alias/keyword 3, group 2, description and
 * searchText 1, which is why every label leads with its verb and the
 * user-worded phrases live in keywords. No keyword string repeats across the
 * nine tools and no indexed field carries a negated-use sentence, because the
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
			"Delivers a message into another session that is already running, for when the user wants to talk to that session mid-task; its reply comes back through thread_read, and a bound chat thread's replies through thread_report and thread_answer" +
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
	{
		name: "thread_rename",
		label: "Rename session",
		description:
			"Changes the label a session is listed under, for when the user asks to call a session something clearer",
		searchText:
			"rename a session, change what a session is called, fix the name a session was started with, update the session label",
		searchKeywords: [
			"rename this session",
			"call it something else",
			"change the session name",
			"give the session a clearer name",
			"fix the session title",
		],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_set_model",
		label: "Switch session model",
		description:
			"Moves a session onto a different model, for when the user asks to switch that session to another model or a cheaper one",
		searchText:
			"switch the model a session runs on, change the session to a different model, pick a cheaper or stronger model for a session",
		searchKeywords: [
			"switch the model",
			"use a different model",
			"change to a cheaper model",
			"a stronger model for that session",
			"swap the session model",
		],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_set_reasoning",
		label: "Set session reasoning level",
		description:
			"Sets how much reasoning a session applies, for when the user asks to raise or lower the thinking effort of a session",
		searchText:
			"set the reasoning level of a session, make a session think harder, ease the thinking effort of a session, adjust reasoning depth",
		searchKeywords: [
			"set the reasoning level",
			"make it think harder",
			"less thinking please",
			"raise the reasoning",
			"dial down the thinking",
		],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_bind",
		label: "Bind session to chat thread",
		description:
			"Attaches a session to an external chat thread on Discord, Telegram, Slack, Notion, Feishu, herdr or a custom connector, for when the user wants a chat conversation connected to a session",
		searchText:
			"connect a discord or telegram thread to this session, attach a slack conversation to a session, let a chat thread talk to a session",
		searchKeywords: ["connect a discord thread", "attach session to chat", "link telegram chat", "bind slack thread", "mirror session to chat"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_unbind",
		label: "Unbind chat thread",
		description: "Detaches a session from its bound chat thread, for when the user wants that chat connection closed",
		searchText: "disconnect the chat thread from the session, detach discord from this session, close the chat connection",
		searchKeywords: ["disconnect the chat thread", "detach from discord", "unlink chat thread", "close the chat connection"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_rebind",
		label: "Rebind chat thread",
		description: "Moves a bound chat thread over to another session, for when the user wants that chat served by a different session",
		searchText: "move the chat thread to another session, reassign the discord thread to a different session, switch which session serves the chat",
		searchKeywords: ["move the chat to another session", "hand the discord thread over", "reassign chat thread", "switch which session serves the chat"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_bindings",
		label: "List chat bindings",
		description: "Shows which chat threads are bound to which sessions with their revisions, for when the user needs a binding id or its revision",
		searchText: "which chats are connected to which sessions, list bound chat threads, look up a binding id and revision",
		searchKeywords: ["which chats are connected", "bound chat threads", "binding revisions", "chat connections list"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_report",
		label: "Report to chat thread",
		description:
			"Posts a milestone, result, question or completion from this session to its bound chat thread, for when the user wants progress relayed to that chat; replies flow back through thread_read, thread_report and thread_answer",
		searchText: "post progress to the discord thread, update the chat with a milestone, relay a question to the chat, announce completion in the chat",
		searchKeywords: ["post progress to discord", "update the chat thread", "relay a question to chat", "send a milestone", "announce completion to chat"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_outbox",
		label: "Read chat outbox",
		description: "Returns the reports waiting for a bound chat thread with a cursor, for when a connector collects what sessions posted",
		searchText: "pending reports for the chat thread, drain the outbox of a binding, collect what sessions posted for a connector",
		searchKeywords: ["pending chat reports", "drain the outbox", "connector pull", "messages waiting for the chat"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_outbox_ack",
		label: "Acknowledge chat outbox",
		description: "Marks outbox rows up to a cursor as posted to the chat, for when a connector confirms delivery",
		searchText: "confirm the reports were posted to the chat, acknowledge the outbox cursor, mark relayed reports delivered",
		searchKeywords: ["confirm posted to chat", "ack outbox cursor", "mark reports delivered", "delivered to discord"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
	{
		name: "thread_answer",
		label: "Answer relayed question",
		description: "Resolves a question a session relayed to a chat thread with the answer that arrived there, for when a connector hands back a chat user's reply",
		searchText: "answer the relayed question from the chat, the chat user replied to the question, resolve the pending question with the chat reply",
		searchKeywords: ["answer from the chat", "reply to relayed question", "chat user answered", "resolve the pending question"],
		group: THREAD_TOOL_SEARCH_GROUP,
		exposure: "search",
		allowLazyActivation: true,
	},
]

/**
 * Family policy carried by exactly one promptGuidelines entry at registration
 * time. Repeating it per tool would dilute every copy and burn nine times the
 * tokens, so the per-tool entries above stay free of policy prose.
 */
export const THREAD_FAMILY_PROMPT_GUIDELINES =
	"Thread tools address peer sessions, never child tasks: call thread_list first and pass a thread_id or unique name it returned, never a guessed address; an ambiguous name returns candidates instead of delivering; leave all_scope unset to stay inside this workspace and set it only when the caller explicitly asks for sessions in every workspace."
