// MCP startup for EQ.omo cases (fused-equivalence-e2e.mjs). A case session loads the plugin's MCP servers exactly as a
// normal session does: the local `_ast_grep` stdio server and the two remote HTTP servers (`context7`, `grep_app`)
// over the real network. Their startup connects run in the background, so a case that prompted right away would
// observe whichever connects happened to have settled: a remote server's instructions reach a system prompt or not,
// and the startup `loaded_surfaces_changed` reaches the client or not. A user's first prompt waits on nothing; the case
// waits for the one point senpi defines as settled (senpi#4850, docs/rpc.md `loaded_surfaces_changed`): the startup
// window closes once every startup connect has settled and the client then receives exactly one
// `loaded_surfaces_changed`. `get_loaded_surfaces` reads never emit that event, so reading the inventory changes
// nothing the case observes.

/** A remote connect is bounded by its server's connect timeout (15 s by default); the window closes after that. */
const STARTUP_SETTLE_MS = 60_000

const surfaces = async (run) => (await run.send({ type: "get_loaded_surfaces" })).data.mcpServers ?? []
const connecting = (servers) => servers.filter((server) => server.status === "connecting").map((server) => server.name)
/**
 * A server that settled `connected`, `idle` (a cached lazy server that needs no startup connect), or `disabled` (the
 * driver turns the remote `context7` and `grep_app` off in the sandbox mcp.json so no third party's live
 * instructions reach the goldens, #12256).
 */
const SETTLED_OK = new Set(["connected", "idle", "disabled"])

/**
 * A server that settled in any other state (degraded, failed) would leave its instructions out of the prompts and
 * retry on its own schedule: the network failed the case's precondition, so the case fails saying so instead of
 * reporting the missing instructions as a golden diff.
 */
function assertSettledOk(servers) {
  const bad = servers.filter((server) => !SETTLED_OK.has(server.status))
  if (bad.length > 0)
    throw new Error(
      `MCP startup did not settle cleanly (${bad.map((server) => `${server.name}=${server.status}`).join(", ")}): the network did not answer`,
    )
}

/**
 * Wait until the current client's MCP startup has settled. When no server is connecting the window is already closed
 * (its event, if any, already arrived) or never opened (every server served from the catalog cache). Either way every
 * server must then be connected or idle.
 */
async function settleMcpStartup(run) {
  const initial = await surfaces(run)
  if (connecting(initial).length === 0) return assertSettledOk(initial)
  const client = run.client
  if (!client.events.some((event) => event.type === "loaded_surfaces_changed"))
    await client.waitForEvent((event) => event.type === "loaded_surfaces_changed", { timeoutMs: STARTUP_SETTLE_MS })
  assertSettledOk(await surfaces(run))
}

/** run.open() with the client's MCP startup settled. */
export async function openSettled(run) {
  await run.open()
  await settleMcpStartup(run)
}

/** The harness's reopenState() (O8 headless: reopen, get_state, close) with the reopened client's MCP startup settled. */
export async function reopenStateSettled(run) {
  await run.open({ resume: true })
  await settleMcpStartup(run)
  const state = await run.send({ type: "get_state" })
  run.states.push(state.data)
  await run.close()
}
