/**
 * Model-facing metadata for the thread tool family.
 *
 * Every tool declares senpi's `exposure: "eval"`, the exposure `bash` has
 * (oh-my-openagent#12903): whenever the session registers an `eval` tool the
 * family is withheld from the model's direct tool list and reached as
 * `tool.<name>({ ... })` inside an eval cell (`tool_schema("<name>")` lists the
 * parameters); without an eval tool each entry is an ordinary direct tool. The
 * policy machinery is senpi's: the eval-only paragraph of the system prompt
 * names every registered tool with its `tool.<name>(...)` form, a direct call
 * answers the per-tool redirect hint instead of running, and `tool_search`
 * answers a query naming one of them with that same hint. An eval-exposed tool
 * is never indexed by the tool-search catalog, so the entries carry no search
 * text or keywords; the label is the UI label and the description is the
 * schema text the model reads through `tool_schema`.
 */

export const THREAD_TOOL_EXPOSURE = "eval"

export interface ThreadToolEntry {
	readonly name: string
	readonly label: string
	/** One sentence: what the tool does plus the situation that selects it, closed by the routing clause. */
	readonly description: string
	/** senpi's eval-only exposure: withheld from the direct list while `eval` exists, callable as `tool.<name>()`. */
	readonly exposure: typeof THREAD_TOOL_EXPOSURE
}

/** Routing clause shared by every description: a positive alternative, never a negation. */
const ROUTE_TO_TASK = "; to spawn a child task instead, use task."

export const THREAD_TOOL_METADATA: readonly ThreadToolEntry[] = [
	{
		name: "thread_create",
		label: "Create session",
		description:
			"Starts a fresh agent session that runs alongside this one, for when the user wants a second session working in parallel" +
			ROUTE_TO_TASK,
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_list",
		label: "List sessions",
		description:
			"Shows every addressable session with its id, name, and status, for when the user needs a valid target address before acting on a session" +
			ROUTE_TO_TASK,
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_read",
		label: "Read session",
		description:
			"Returns the transcript and latest output of another session, for when the user asks what another session said or produced" +
			ROUTE_TO_TASK,
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_send",
		label: "Send message to session",
		description:
			"Delivers a message into another session that is already running, for when the user wants to talk to that session mid-task; its reply comes back through thread_read, and a bound chat thread's replies through thread_report and thread_answer" +
			ROUTE_TO_TASK,
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_interrupt",
		label: "Interrupt session turn",
		description:
			"Stops the turn running in another session, for when the user wants to halt a session that is going down the wrong path" +
			ROUTE_TO_TASK,
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_close",
		label: "Close session",
		description:
			"Closes another session on this device or on another of the account's devices, for when the user is done with that session and wants it shut down" +
			ROUTE_TO_TASK,
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_handoff",
		label: "Hand off session",
		description:
			"Moves the current request to an old session that has the context, for when the user says to hand this off or reopen that earlier conversation" +
			ROUTE_TO_TASK,
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_rename",
		label: "Rename session",
		description:
			"Changes the label a session is listed under, for when the user asks to call a session something clearer",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_set_model",
		label: "Switch session model",
		description:
			"Moves a session onto a different model, for when the user asks to switch that session to another model or a cheaper one",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_set_reasoning",
		label: "Set session reasoning level",
		description:
			"Sets how much reasoning a session applies, for when the user asks to raise or lower the thinking effort of a session",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_bind",
		label: "Bind session to chat thread",
		description:
			"Attaches a session to an external chat thread on Discord, Telegram, Slack, Notion, Feishu, herdr or a custom connector, for when the user wants a chat conversation connected to a session",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_unbind",
		label: "Unbind chat thread",
		description: "Detaches a session from its bound chat thread, for when the user wants that chat connection closed",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_rebind",
		label: "Rebind chat thread",
		description: "Moves a bound chat thread over to another session, for when the user wants that chat served by a different session",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_bindings",
		label: "List chat bindings",
		description: "Shows which chat threads are bound to which sessions with their revisions, for when the user needs a binding id or its revision",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_report",
		label: "Report to chat thread",
		description:
			"Posts a milestone, result, question or completion from this session to its bound chat thread, for when the user wants progress relayed to that chat; replies flow back through thread_read, thread_report and thread_answer",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_outbox",
		label: "Read chat outbox",
		description: "Returns the reports waiting for a bound chat thread with a cursor, for when a connector collects what sessions posted",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_outbox_ack",
		label: "Acknowledge chat outbox",
		description: "Marks outbox rows up to a cursor as posted to the chat, for when a connector confirms delivery",
		exposure: THREAD_TOOL_EXPOSURE,
	},
	{
		name: "thread_answer",
		label: "Answer relayed question",
		description: "Resolves a question a session relayed to a chat thread with the answer that arrived there, for when a connector hands back a chat user's reply",
		exposure: THREAD_TOOL_EXPOSURE,
	},
]

/**
 * Family policy carried by exactly one promptGuidelines entry at registration
 * time. Repeating it per tool would dilute every copy and burn eighteen times
 * the tokens, so the per-tool entries above stay free of policy prose. senpi
 * renders the guidelines of a withheld eval-only tool into the system prompt
 * exactly as it does for an active one, so this text reaches the model on both
 * surfaces.
 */
export const THREAD_FAMILY_PROMPT_GUIDELINES =
	"Thread tools address peer sessions, never child tasks: call thread_list first and pass a thread_id or unique name it returned, never a guessed address; an ambiguous name returns candidates instead of delivering; leave all_scope unset to stay inside this workspace and set it only when the caller explicitly asks for sessions in every workspace; when you mention a thread to the user, paste the link its result carries instead of writing its id or inventing a link."
