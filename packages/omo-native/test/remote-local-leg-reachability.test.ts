// Security/architecture contract (omo#13440, design v7 section 7), the companion of remote-local-reachability.test.ts:
// this device's operator endpoint leg (`local-sessions.ts`) stays out of the local-only verbs' graph, yet remote-cli.ts
// loads it lazily inside the same `omo remote sessions|open|send|...` processes that skip the engine-trust stage. What
// the leg adds to that graph - the files the local-only roots do not reach - may open sockets only at the pinned local
// connects and start processes only at the pinned sites; a new network module, network call, socket module, worker or
// spawn site in it fails here. The pinned sets below are the detector's own output; update them only with a security
// review.
import { describe, expect, test } from "bun:test"
import {
  builtin,
  connectCalls,
  importersOf,
  LOCAL_ONLY_ROOTS,
  NETWORK_MODULES,
  repoRoot,
  rootsGraph,
  scanSources,
  sourcesOf,
  spawnModule,
} from "./remote-graph-scan"
import { spawnCallSites } from "./spawn-call-sites"

const LEG = "packages/omo-senpi/src/components/remote/local-sessions.ts"
const LEG_ROOT: Record<string, readonly string[]> = {
  [LEG]: [
    LEG,
    "packages/omo-senpi/src/components/remote/sessions-local.ts",
    "packages/omo-senpi/src/components/remote/sessions-local-list.ts",
    "packages/omo-senpi/src/components/remote/sessions-local-members.ts",
    "packages/omo-senpi/src/components/thread/live-surface.ts",
  ],
}

// live-surface.ts, the thread client runtime's entry, re-exports the alias registry, whose requests go to the account
// service; no member of the leg calls it.
const NETWORK_CALLS = ["packages/omo-senpi/src/components/thread/remote/alias-registry.ts: ?? fetch"]
// The modules that open the operator endpoint's sockets, each with its connects: every one takes a socket path.
const CONNECT_CALLS = {
  "packages/omo-senpi/src/components/remote/local-wire.ts": ["createConnection(path)"],
  "packages/omo-senpi/src/components/remote/sessions-local-list.ts": ["createConnection(path)"],
  "packages/omo-senpi/src/components/thread/live-surface.ts": ["createConnection(path)"],
  "packages/senpi-task/src/runners/rpc-host/socket-client.ts": ["(options.connect ?? createConnection)(endpoint)"],
}
const SPAWN_IMPORTERS = [
  "packages/omo-senpi/src/components/thread/live-surface.ts",
  "packages/omo-senpi/src/components/thread/worktree/thread-worktree.ts",
]
// The engine's `host status --all` (the endpoint listing) and the git a thread worktree runs.
const SPAWN_CALL_SITES = [
  "packages/omo-senpi/src/components/thread/live-surface.ts: node:child_process#execFile(launch.command; [...launch.prefixArgs, ...HOST_STATUS_ALL_ARGS])",
  'packages/omo-senpi/src/components/thread/worktree/thread-worktree.ts: node:child_process#execFile("git"; [...args])',
  'packages/omo-senpi/src/components/thread/worktree/worktree-rpc.ts: git(["reflog", "show", "--format=%H", `refs/heads/${branch}`]; path)',
  'packages/omo-senpi/src/components/thread/worktree/worktree-rpc.ts: git(["rev-parse", "--path-format=absolute", "--git-common-dir"]; path)',
  'packages/omo-senpi/src/components/thread/worktree/worktree-rpc.ts: git(["rev-parse", "--show-toplevel"]; path)',
  'packages/omo-senpi/src/components/thread/worktree/worktree-rpc.ts: git(["status", "--porcelain", "--ignored", "--untracked-files=all"]; path)',
  'packages/omo-senpi/src/components/thread/worktree/worktree-rpc.ts: git(["symbolic-ref", "--short", "HEAD"]; path)',
  'packages/omo-senpi/src/components/thread/worktree/worktree-rpc.ts: git(["worktree", "list", "--porcelain"]; path)',
  "packages/omo-senpi/src/components/thread/worktree/worktree-rpc.ts: isLinkedWorktreeTop(path; git)",
  'packages/omo-senpi/src/components/thread/worktree/worktree-rpc.ts: removeRequested(recordOf(record["remove"]); root)',
]

describe("remote local-path reachability: this device's operator endpoint leg", () => {
  test("#given the leg's module graph beyond the local-only roots' #when it is scanned #then it opens only the pinned local sockets, makes only the pinned network call, and starts processes only at the pinned sites", async () => {
    // given
    const localOnly = await rootsGraph(LOCAL_ONLY_ROOTS)
    const leg = await rootsGraph(LEG_ROOT)
    const added = Object.fromEntries(Object.entries(leg).filter(([file]) => !(file in localOnly)))
    const sources = sourcesOf(added)

    // when
    const { calls, workers, bunPrimitives } = scanSources(sources)
    const socketModules = importersOf(added, builtin("net"))
    const sites = spawnCallSites(repoRoot, sourcesOf(leg)).filter((site) =>
      sources.some((file) => site.startsWith(`${file}: `)),
    )

    // then: the leg is outside the local-only graph, so the scan below covers it
    expect(sources).toContain(LEG)
    // then: the network rules
    expect(importersOf(added, (path) => NETWORK_MODULES.has(path.replace(/^node:/, "")))).toEqual([])
    expect(calls).toEqual([...NETWORK_CALLS].sort())
    expect(socketModules).toEqual(Object.keys(CONNECT_CALLS).sort())
    expect(Object.fromEntries(socketModules.map((file) => [file, connectCalls(file)]))).toEqual(CONNECT_CALLS)
    expect(workers).toEqual([])
    expect(importersOf(added, builtin("worker_threads"))).toEqual([])
    // then: the spawn rules
    expect(importersOf(added, spawnModule)).toEqual([...SPAWN_IMPORTERS].sort())
    expect(bunPrimitives).toEqual({})
    expect(sites).toEqual([...SPAWN_CALL_SITES].sort())
  })
})
