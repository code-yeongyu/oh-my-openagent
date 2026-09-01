#!/usr/bin/env bun
/**
 * (c) Terminal -> UI: a session created by a TERMINAL client (raw JSONL on the shared
 * host socket, no desktop code in its path) surfaces in the desktop shell data path.
 *
 * The proof is the shell snapshot itself - the same `getShellSnapshot()` read the
 * shellSnapshot HTTP route serves - containing a row whose id is the DERIVED mirror thread
 * id and whose project maps back to the terminal session's cwd. The mirror runs on its own
 * background schedule, so the row appears without anyone asking for a refresh; the wait is
 * on the engine's `thread.created` domain event, never on a timer.
 *
 * Failure path: refreshing against a client whose host is gone yields a typed
 * OmoSharedProcess failure, the snapshot keeps exactly the rows it had, and cleanup runs.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import {
  HostClient,
  cleanupAllAndWait,
  createReport,
  desktopDependency,
  desktopModule,
  flag,
  installCleanupHooks,
  makeScratch,
  startFakeModelServer,
  startRealHost,
  verifyCleanup,
  writeCliShim,
  writeMockModelsJson,
} from "./lib/harness.mjs"
import { loadMirror, startDesktopShell } from "./lib/desktop-shell.mjs"

const report = createReport("terminal-to-ui")
installCleanupHooks()

const Effect = await desktopDependency("effect/Effect")
const Fiber = await desktopDependency("effect/Fiber")
const Schedule = await desktopDependency("effect/Schedule")
const Stream = await desktopDependency("effect/Stream")

let scratchDir
let socketPath
let shell
try {
  const scratch = makeScratch("t13-terminal-to-ui")
  scratchDir = scratch.dir
  const fake = await startFakeModelServer([{ text: "terminal-ack" }])
  writeMockModelsJson(scratch.agentDir, fake)

  // The host is started by the TERMINAL side; the desktop only dials in.
  const host = await startRealHost(scratch, { extraArgs: ["--provider", "mock", "--model", "mock-model"] })
  socketPath = host.socket
  report.log(`host pid=${host.pid} socket=${socketPath}`)

  const terminalCwd = join(scratch.dir, "terminal-project")
  mkdirSync(terminalCwd, { recursive: true })

  shell = await startDesktopShell({ cwd: scratch.cwd, prefix: "t13-terminal-to-ui-" })
  const { deriveMirrorProjectId, deriveMirrorThreadId, makeOmoSessionMirror } = await loadMirror()
  // The desktop dials the host the TERMINAL already started: ensureOmoSocketHost finds a
  // compatible host on the socket and attaches instead of spawning a second one.
  const { makeOmoSharedProcess } = await desktopModule("apps/server/src/provider/Layers/OmoSharedProcess.ts")
  const { OrchestrationEngineService } = shell

  const binaryPath = writeCliShim(scratch)

  const terminal = await HostClient.connect(socketPath, "terminal")

  const scenario = Effect.gen(function* () {
    const shared = yield* makeOmoSharedProcess({
      binaryPath,
      cwd: scratch.cwd,
      socketPath,
      env: { ...scratch.env, SENPI_CODING_AGENT_DIR: scratch.agentDir, OMO_CODING_AGENT_DIR: scratch.agentDir },
    })
    const mirror = yield* makeOmoSessionMirror({
      shared,
      fallbackModel: { instanceId: "omo", model: "mock/mock-model" },
    })
    const engine = yield* Effect.service(OrchestrationEngineService)

    // ---- the terminal client creates and names its session ----
    // Naming completes BEFORE the mirror starts observing, so the first mirrored row is
    // asserted against one settled host title. (The mirror also propagates later renames;
    // that behavior belongs to the mirror's own suite, not to this cross-surface proof.)
    const opened = yield* Effect.promise(() =>
      terminal.openSession({ cwd: terminalCwd, sessionPath: join(scratch.sessionDir, "terminal.jsonl") }),
    )
    yield* Effect.promise(() =>
      terminal.request({ type: "set_session_name", sessionId: opened.routingId, name: "terminal-session" }),
    )
    const durableId = opened.state.sessionId
    const expectedThreadId = deriveMirrorThreadId(durableId)
    const expectedProjectId = deriveMirrorProjectId(terminalCwd)

    // Subscribe to the engine's hot domain-event stream BEFORE the mirror starts, then let
    // the mirror's OWN background poll discover the session: the row's arrival is awaited as
    // an event, never polled and never triggered by a manual refresh from this script.
    const created = yield* Effect.forkScoped(
      Stream.runHead(
        Stream.filter(
          engine.streamDomainEvents,
          (event) => event.type === "thread.created" && event.payload.threadId === expectedThreadId,
        ),
      ).pipe(Effect.timeout("30 seconds")),
    )
    yield* Effect.forkScoped(
      mirror.refresh.pipe(Effect.repeat(Schedule.spaced("200 millis")), Effect.ignore),
    )
    const createdEvent = yield* Fiber.join(created)
    report.log(`terminal durable=${durableId} derived_thread=${expectedThreadId}`)

    // ---- the assertion: the shell snapshot the UI reads contains the row ----
    const snapshot = yield* Effect.promise(() => shell.shellSnapshot())
    const row = snapshot.threads.find((thread) => thread.id === expectedThreadId)
    const project = snapshot.projects.find((entry) => entry.id === row?.projectId)
    report.assert(
      "shell-snapshot-contains-terminal-session",
      row !== undefined && createdEvent !== undefined,
      `thread_id=${row?.id ?? "missing"} title=${row?.title ?? "none"} rows=${snapshot.threads.length}`,
    )
    report.assert(
      "cwd-project-mapping",
      row?.projectId === expectedProjectId && project?.workspaceRoot === terminalCwd,
      `project_id=${row?.projectId ?? "none"} expected=${expectedProjectId} workspace_root=${project?.workspaceRoot ?? "none"}`,
    )
    report.assert(
      "row-title-from-host-session-name",
      row?.title === "terminal-session",
      `title=${row?.title ?? "none"}`,
    )

    // ---- typed error path: the desktop client addressed at an unknown session ----
    const rowsBefore = (yield* Effect.promise(() => shell.shellSnapshot())).threads.length
    const failure = yield* shared
      .request({ type: "get_state", sessionId: "rpc-unknown-t13c" })
      .pipe(Effect.flip)
    const rowsAfter = (yield* Effect.promise(() => shell.shellSnapshot())).threads.length
    report.assert(
      "unknown-target-typed-error",
      failure._tag === "OmoSharedProcessRequestFailed" &&
        failure.detail === "unknown_session" &&
        rowsAfter === rowsBefore,
      `wire_tag=${failure._tag} wire_detail=${failure.detail} rows_before=${rowsBefore} rows_after=${rowsAfter}`,
    )
  })

  await shell.runtime.runPromise(Effect.scoped(scenario))
  await fake.stop()
} catch (error) {
  report.log(
    `FAIL terminal-to-ui harness error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  )
  process.exitCode = 1
} finally {
  await shell?.dispose()
  await cleanupAllAndWait()
  verifyCleanup(report, { scratchDir, socketPaths: socketPath === undefined ? [] : [socketPath] })
  const verdict = report.failures === 0 && process.exitCode !== 1
  report.log(`${verdict ? "PASS" : "FAIL"} terminal-to-ui assertions_failed=${report.failures}`)
  report.write(flag("--out"))
  process.exit(verdict ? 0 : 1)
}
