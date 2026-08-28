#!/usr/bin/env bun
/**
 * (d) Desktop -> CLI: a session created by the DESKTOP-shaped provider client is
 * addressable from a terminal client.
 *
 * The proof is the CLI side's own view: the shipped address book assembled from the CLI
 * connection's `list_sessions` plus disk contains the desktop session with status "live",
 * `resolveTarget` reaches it by name and by durable id, and a message sent from the CLI
 * lands in the desktop session's transcript read back through the DESKTOP client.
 *
 * The desktop thread row is checked too, so the same session is provably one session on
 * both surfaces rather than two lookalikes.
 *
 * Failure path: resolving a name nobody owns is a typed `not_found`, and the wire refuses
 * an unknown routing handle with `unknown_session`; cleanup still runs.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import {
  HostClient,
  cleanupAllAndWait,
  countUserTurns,
  createReport,
  desktopDependency,
  desktopModule,
  flag,
  installCleanupHooks,
  liveAddressBook,
  mailboxPortFor,
  makeScratch,
  startFakeModelServer,
  threadComponent,
  trackDesktopManagedHost,
  verifyCleanup,
  writeCliShim,
  writeMockModelsJson,
} from "./lib/harness.mjs"
import { loadMirror, startDesktopShell } from "./lib/desktop-shell.mjs"

const SEND_NEEDLE = "t13d-cli-to-desktop-needle"

const report = createReport("desktop-to-cli")
installCleanupHooks()

const Effect = await desktopDependency("effect/Effect")
const Fiber = await desktopDependency("effect/Fiber")
const Schedule = await desktopDependency("effect/Schedule")
const Stream = await desktopDependency("effect/Stream")

let scratchDir
let socketPath
let shell
let mailbox
try {
  const scratch = makeScratch("t13-desktop-to-cli")
  scratchDir = scratch.dir
  const fake = await startFakeModelServer([{ text: "desktop-session-ack" }, { text: "cli-send-ack" }])
  writeMockModelsJson(scratch.agentDir, fake)

  const binaryPath = writeCliShim(scratch)
  socketPath = join(scratch.dir, "rpc", "rpc.sock")
  const managedHost = trackDesktopManagedHost(scratch.agentDir, socketPath)

  const desktopCwd = join(scratch.dir, "desktop-project")
  mkdirSync(desktopCwd, { recursive: true })

  shell = await startDesktopShell({ cwd: scratch.cwd, prefix: "t13-desktop-to-cli-" })
  const { deriveMirrorThreadId, makeOmoSessionMirror } = await loadMirror()
  const { makeOmoSharedProcess } = await desktopModule("apps/server/src/provider/Layers/OmoSharedProcess.ts")
  const { OrchestrationEngineService } = shell
  const { resolveTarget } = await threadComponent("addressing")
  const { createOrderedDeliveryMailbox } = await threadComponent("mailbox")

  const scenario = Effect.gen(function* () {
    // ---- the desktop side owns the host and creates the session ----
    const shared = yield* makeOmoSharedProcess({
      binaryPath,
      cwd: scratch.cwd,
      socketPath,
      env: { ...scratch.env, SENPI_CODING_AGENT_DIR: scratch.agentDir, OMO_CODING_AGENT_DIR: scratch.agentDir },
    })
    yield* shared.request({ type: "get_protocol_info" })
    report.log(`desktop-managed host pid=${managedHost.pid()} socket=${socketPath}`)

    const opened = yield* shared.request({
      type: "open_session",
      cwd: desktopCwd,
      sessionPath: join(scratch.sessionDir, "desktop-owned.jsonl"),
    })
    const routingId = opened.data.sessionId
    const durableId = opened.data.state.sessionId
    yield* shared.request({ type: "set_session_name", sessionId: routingId, name: "desktop-owned" })
    report.log(`desktop routing=${routingId} durable=${durableId}`)

    // The desktop's own thread row, so both surfaces are provably describing one session.
    const engine = yield* Effect.service(OrchestrationEngineService)
    const mirror = yield* makeOmoSessionMirror({
      shared,
      fallbackModel: { instanceId: "omo", model: "mock/mock-model" },
    })
    const expectedThreadId = deriveMirrorThreadId(durableId)
    const created = yield* Effect.forkScoped(
      Stream.runHead(
        Stream.filter(
          engine.streamDomainEvents,
          (event) => event.type === "thread.created" && event.payload.threadId === expectedThreadId,
        ),
      ).pipe(Effect.timeout("30 seconds")),
    )
    yield* Effect.forkScoped(mirror.refresh.pipe(Effect.repeat(Schedule.spaced("200 millis")), Effect.ignore))
    yield* Fiber.join(created)

    // ---- the CLI side: an independent terminal connection to the same host ----
    const cli = yield* Effect.promise(() => HostClient.connect(socketPath, "cli"))
    const { entries, addressEntries } = yield* Effect.promise(() =>
      liveAddressBook(cli, socketPath, scratch.sessionDir),
    )
    const entry = entries.find((candidate) => candidate.durable_id === durableId)
    report.assert(
      "thread-list-shows-desktop-session-live",
      entry !== undefined && entry.status === "live" && entry.routing_id === routingId,
      `status=${entry?.status ?? "missing"} routing_id=${entry?.routing_id ?? "none"} entries=${entries.length}`,
    )

    const byName = resolveTarget(addressEntries, "desktop-owned", { all_scope: true })
    const byId = resolveTarget(addressEntries, durableId, { all_scope: true })
    report.assert(
      "cli-resolves-desktop-session",
      byName.kind === "ok" &&
        byName.entry.thread_id === durableId &&
        byId.kind === "ok" &&
        byId.resolution === "id",
      `by_name=${byName.kind === "ok" ? byName.resolution : JSON.stringify(byName)} by_id=${byId.kind === "ok" ? byId.resolution : JSON.stringify(byId)}`,
    )

    // ---- the CLI addresses it for real: a send that lands in the transcript ----
    mailbox = createOrderedDeliveryMailbox({
      directory: join(scratch.dir, "mailbox"),
      portFor: (target) => (target === routingId ? mailboxPortFor(cli, routingId) : undefined),
    })
    const sendResult = yield* Effect.promise(() =>
      mailbox.accept(routingId, SEND_NEEDLE, { delivery: "auto" }),
    )
    // Read the transcript back through the DESKTOP client: one session, both surfaces.
    const desktopView = (yield* shared.request({ type: "get_messages", sessionId: routingId })).data.messages
    report.assert(
      "cli-send-lands-in-desktop-session",
      sendResult.kind === "ok" && countUserTurns(desktopView, SEND_NEEDLE) === 1,
      `delivery=${sendResult.kind === "ok" ? sendResult.delivery : JSON.stringify(sendResult)} user_turns=${countUserTurns(desktopView, SEND_NEEDLE)}`,
    )

    const snapshot = yield* Effect.promise(() => shell.shellSnapshot())
    report.assert(
      "desktop-row-matches-cli-entry",
      snapshot.threads.some((thread) => thread.id === expectedThreadId),
      `derived_thread=${expectedThreadId} rows=${snapshot.threads.length}`,
    )

    // ---- typed error path: unknown target ----
    const unknownResolution = resolveTarget(addressEntries, "no-such-thread-t13d", { all_scope: true })
    const wireFailure = yield* Effect.promise(() =>
      cli.raw({ type: "get_state", sessionId: "rpc-unknown-t13d" }),
    )
    const afterUnknown = (yield* shared.request({ type: "get_messages", sessionId: routingId })).data.messages
    report.assert(
      "unknown-target-typed-error",
      unknownResolution.kind === "error" &&
        unknownResolution.code === "not_found" &&
        wireFailure.success === false &&
        wireFailure.error === "unknown_session" &&
        afterUnknown.length === desktopView.length,
      `tool_code=${unknownResolution.kind === "error" ? unknownResolution.code : "none"} wire_error=${wireFailure.error} transcript_unchanged=${afterUnknown.length === desktopView.length}`,
    )

    yield* shared.request({ type: "close_session", sessionId: routingId })
  })

  await shell.runtime.runPromise(Effect.scoped(scenario))
  await fake.stop()
} catch (error) {
  report.log(
    `FAIL desktop-to-cli harness error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  )
  process.exitCode = 1
} finally {
  mailbox?.close()
  await shell?.dispose()
  await cleanupAllAndWait()
  verifyCleanup(report, { scratchDir, socketPaths: socketPath === undefined ? [] : [socketPath] })
  const verdict = report.failures === 0 && process.exitCode !== 1
  report.log(`${verdict ? "PASS" : "FAIL"} desktop-to-cli assertions_failed=${report.failures}`)
  report.write(flag("--out"))
  process.exit(verdict ? 0 : 1)
}
