#!/usr/bin/env bun
/**
 * (b) Desktop-shaped provider client: the same thread-tool operations as (a), driven
 * through the REAL desktop client - `makeOmoSharedProcess` from
 * apps/server/src/provider/Layers/OmoSharedProcess.ts - so the argv, env and ensure
 * behavior are the desktop's, not a hand-rolled imitation.
 *
 * The desktop client starts its own host through `ensureOmoSocketHost` (detached, with a
 * `desktop-host.json` pid file); the harness registers that pid so the run stays leak-free.
 *
 * Assertions read the target session's transcript through the same client
 * (`get_messages`), and address resolution runs through the shipped components against
 * the host's live `list_sessions`.
 *
 * Failure path: a command addressed at an unknown session fails as a typed
 * OmoSharedProcessRequestFailed carrying `unknown_session`, and nothing lands in the
 * target transcript.
 */
import { join } from "node:path"

import {
  cleanupAllAndWait,
  countUserTurns,
  createReport,
  desktopDependency,
  desktopModule,
  flag,
  installCleanupHooks,
  makeScratch,
  messageText,
  startFakeModelServer,
  threadComponent,
  trackDesktopManagedHost,
  verifyCleanup,
  writeCliShim,
  writeMockModelsJson,
} from "./lib/harness.mjs"

const CREATE_NEEDLE = "t13b-desktop-created-needle"
const SEND_NEEDLE = "t13b-desktop-send-needle"
const STEER_NEEDLE = "t13b-desktop-steer-needle"

const report = createReport("desktop-client")
installCleanupHooks()

const Effect = await desktopDependency("effect/Effect")
const Fiber = await desktopDependency("effect/Fiber")
const Stream = await desktopDependency("effect/Stream")

/**
 * Await the Nth matching record on the desktop client's own event stream. Subscribing
 * BEFORE the triggering command is what makes this deterministic - no sleeps, no polling.
 */
const awaitRecords = (shared, predicate, count = 1, timeoutMs = 120_000) =>
  Effect.callback((resume) => {
    let seen = 0
    const timer = setTimeout(
      () => resume(Effect.fail(new Error(`timeout after ${timeoutMs}ms waiting for ${count} record(s)`))),
      timeoutMs,
    )
    const fiber = Effect.runFork(
      Stream.runForEach(shared.records, (event) => {
        if (!predicate(event.record)) return Effect.void
        seen += 1
        if (seen >= count) {
          clearTimeout(timer)
          resume(Effect.void)
        }
        return Effect.void
      }),
    )
    return Effect.sync(() => {
      clearTimeout(timer)
      Effect.runFork(Fiber.interrupt(fiber))
    })
  })

let scratchDir
let socketPath
let mailbox
try {
  const scratch = makeScratch("t13-desktop-client")
  scratchDir = scratch.dir
  const fake = await startFakeModelServer([
    { text: "desktop-created-ack" },
    { text: "desktop-send-ack" },
    { hold: true },
    { text: "desktop-steer-ack" },
    { text: "desktop-idle-ack" },
  ])
  writeMockModelsJson(scratch.agentDir, fake)

  // The desktop resolves its own binary; point it at this senpi checkout.
  const binaryPath = writeCliShim(scratch)
  socketPath = join(scratch.dir, "rpc", "rpc.sock")
  const managedHost = trackDesktopManagedHost(scratch.agentDir, socketPath)

  const { makeOmoSharedProcess } = await desktopModule("apps/server/src/provider/Layers/OmoSharedProcess.ts")
  const { resolveTarget } = await threadComponent("addressing")
  const { assembleAddressBook, scanDiskSessions, toThreadAddressEntries } = await threadComponent("address-book")
  const { createOrderedDeliveryMailbox } = await threadComponent("mailbox")

  const program = Effect.gen(function* () {
    const shared = yield* makeOmoSharedProcess({
      binaryPath,
      cwd: scratch.cwd,
      socketPath,
      env: {
        ...scratch.env,
        SENPI_CODING_AGENT_DIR: scratch.agentDir,
        OMO_CODING_AGENT_DIR: scratch.agentDir,
      },
    })

    const info = yield* shared.request({ type: "get_protocol_info" })
    report.assert(
      "desktop-client-handshake",
      info.data?.mode === "multi" &&
        Array.isArray(info.data?.capabilities) &&
        info.data.capabilities.includes("multi_session") &&
        info.data.capabilities.includes("extension_events"),
      `serverVersion=${info.data?.serverVersion} capabilities=${JSON.stringify(info.data?.capabilities)}`,
    )
    report.log(`desktop-managed host pid=${managedHost.pid()} socket=${socketPath}`)

    const messages = (routingId) =>
      shared
        .request({ type: "get_messages", sessionId: routingId })
        .pipe(Effect.map((response) => response.data.messages ?? []))

    const promptAndSettle = (routingId, message, options = {}) =>
      Effect.gen(function* () {
        const waiter = yield* Effect.forkChild(
          awaitRecords(shared, (record) => record.type === "agent_settled" && record.sessionId === routingId),
        )
        yield* shared.request({ type: "prompt", sessionId: routingId, message, ...options })
        yield* Fiber.join(waiter)
      })

    // ---- thread_create through the desktop-shaped client ----
    const opened = yield* shared.request({
      type: "open_session",
      cwd: scratch.cwd,
      sessionPath: join(scratch.sessionDir, "desktop-peer.jsonl"),
    })
    const routingId = opened.data.sessionId
    const durableId = opened.data.state.sessionId
    yield* shared.request({ type: "set_session_name", sessionId: routingId, name: "desktop-peer" })
    report.log(`peer routing=${routingId} durable=${durableId}`)

    // Mailbox port over the DESKTOP transport: snapshot/steer/start all go through
    // makeOmoSharedProcess, and the settle is awaited on its record stream.
    mailbox = createOrderedDeliveryMailbox({
      directory: join(scratch.dir, "mailbox"),
      portFor: (target) =>
        target !== routingId
          ? undefined
          : {
              snapshot: () =>
                Effect.runPromise(
                  shared.request({ type: "get_state", sessionId: routingId }).pipe(
                    Effect.map((response) => ({ active: response.data?.isStreaming === true })),
                  ),
                ),
              steer: (message) =>
                Effect.runPromise(shared.request({ type: "steer", sessionId: routingId, message })),
              start: (message) =>
                Effect.runPromise(
                  Effect.gen(function* () {
                    const waiter = yield* Effect.forkChild(
                      awaitRecords(
                        shared,
                        (record) => record.type === "agent_settled" && record.sessionId === routingId,
                      ),
                    )
                    yield* shared.request({ type: "prompt", sessionId: routingId, message })
                    yield* Fiber.join(waiter)
                    return { turn_id: `${routingId}-turn` }
                  }),
                ),
            },
    })

    yield* promptAndSettle(routingId, CREATE_NEEDLE)
    const afterCreate = yield* messages(routingId)
    report.assert(
      "create-transcript",
      countUserTurns(afterCreate, CREATE_NEEDLE) === 1 &&
        afterCreate.some(
          (message) => message.role === "assistant" && messageText(message).includes("desktop-created-ack"),
        ),
      `user_turns=${countUserTurns(afterCreate, CREATE_NEEDLE)} roles=${JSON.stringify(afterCreate.map((m) => m.role))}`,
    )

    // ---- addressing over the desktop client's own list_sessions ----
    const listed = yield* shared.request({ type: "list_sessions" })
    const entries = assembleAddressBook(
      [{ socket: socketPath, list_sessions: listed.data }],
      scanDiskSessions(scratch.sessionDir, { source_host: socketPath }),
    )
    const addressEntries = toThreadAddressEntries(entries)
    const resolved = resolveTarget(addressEntries, "desktop-peer", { all_scope: true })
    report.assert(
      "address-book-resolves-peer",
      resolved.kind === "ok" && resolved.entry.thread_id === durableId,
      `resolution=${resolved.kind === "ok" ? resolved.resolution : JSON.stringify(resolved)} entries=${entries.length}`,
    )

    // ---- thread_send through the shipped ordered-delivery mailbox ----
    // The mailbox's port is bound to the DESKTOP client, so the same component that serves
    // the CLI surface drives the desktop transport; its retry loop is also what absorbs the
    // host's "already processing" window instead of a sleep.
    const sendResult = yield* Effect.promise(() =>
      mailbox.accept(routingId, SEND_NEEDLE, { delivery: "auto" }),
    )
    const afterSend = yield* messages(routingId)
    report.assert(
      "send-transcript",
      sendResult.kind === "ok" && countUserTurns(afterSend, SEND_NEEDLE) === 1,
      `delivery=${sendResult.kind === "ok" ? sendResult.delivery : JSON.stringify(sendResult)} user_turns=${countUserTurns(afterSend, SEND_NEEDLE)}`,
    )

    // ---- thread_send delivery=steer during an ACTIVE turn ----
    const started = yield* Effect.forkChild(
      awaitRecords(shared, (record) => record.type === "agent_start" && record.sessionId === routingId),
    )
    // The steered message runs as a second TURN inside the same agent run, so the run emits
    // exactly one settle covering both turns; waiting for two would hang forever. The
    // subscription is opened before the steer so the settle cannot be missed.
    const runSettled = yield* Effect.forkChild(
      awaitRecords(shared, (record) => record.type === "agent_settled" && record.sessionId === routingId),
    )
    yield* shared.request({ type: "prompt", sessionId: routingId, message: "t13b-held-turn" })
    yield* Fiber.join(started)
    yield* shared.request({ type: "steer", sessionId: routingId, message: STEER_NEEDLE })
    yield* Effect.sync(() => fake.releaseHolds())
    yield* Fiber.join(runSettled)
    const afterSteer = yield* messages(routingId)
    report.assert(
      "steer-transcript",
      countUserTurns(afterSteer, STEER_NEEDLE) === 1,
      `user_turns=${countUserTurns(afterSteer, STEER_NEEDLE)} roles=${JSON.stringify(afterSteer.map((m) => m.role))}`,
    )

    // ---- typed error path: unknown target ----
    const unknownResolution = resolveTarget(addressEntries, "no-such-thread-t13b", { all_scope: true })
    const wireFailure = yield* shared
      .request({ type: "steer", sessionId: "rpc-unknown-t13b", message: "should not land" })
      .pipe(Effect.flip)
    const afterUnknown = yield* messages(routingId)
    report.assert(
      "unknown-target-typed-error",
      unknownResolution.kind === "error" &&
        unknownResolution.code === "not_found" &&
        wireFailure._tag === "OmoSharedProcessRequestFailed" &&
        wireFailure.detail === "unknown_session" &&
        afterUnknown.length === afterSteer.length,
      `tool_code=${unknownResolution.kind === "error" ? unknownResolution.code : "none"} wire_tag=${wireFailure._tag} wire_detail=${wireFailure.detail} transcript_unchanged=${afterUnknown.length === afterSteer.length}`,
    )

    yield* shared.request({ type: "close_session", sessionId: routingId })
  })

  await Effect.runPromise(Effect.scoped(program))
  await fake.stop()
} catch (error) {
  report.log(
    `FAIL desktop-client harness error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  )
  process.exitCode = 1
} finally {
  mailbox?.close()
  await cleanupAllAndWait()
  verifyCleanup(report, { scratchDir, socketPaths: socketPath === undefined ? [] : [socketPath] })
  const verdict = report.failures === 0 && process.exitCode !== 1
  report.log(`${verdict ? "PASS" : "FAIL"} desktop-client assertions_failed=${report.failures}`)
  report.write(flag("--out"))
  process.exit(verdict ? 0 : 1)
}
