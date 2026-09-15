import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const registryBefore = `        // Reply on a bounded deadline, but keep entry, attachments and reservations until exit.
        let timer;
        await Promise.race([
            entry.worker.close(this.closeGraceMs),
            new Promise((resolve) => {
                timer = setTimeout(() => {
                    if (entry.state !== "closed")
                        entry.state = "quarantined";
                    resolve();
                }, this.closeGraceMs);
            }),
        ]);
        if (timer)
            clearTimeout(timer);`
const registryAfter = `        // The worker deadline requests termination; only exit releases registry ownership.
        await entry.worker.close(this.closeGraceMs);`

const failBefore = `    fail(error) {
        if (this.stopped)
            return;
        this.callbacks.failure(error);
        if (this.writer && this.sessionId) {
            this.writer.enqueue(this.sessionId, { type: "session_error", error });
            this.writer.closeSession(this.sessionId, {
                type: "response",
                command: "close_session",
                success: false,
                error,
            });
        }
        this.quarantine();
    }`
const failAfter = `    fail(error) {
        if (this.stopped)
            return;
        this.callbacks.failure(error);
        if (this.writer && this.sessionId)
            this.pendingTerminal = { writer: this.writer, sessionId: this.sessionId, error };
        this.quarantine();
    }`

const exitBefore = `                this.listeners.clear();
                callbacks.exit();
                resolve();`
const exitAfter = `                this.listeners.clear();
                callbacks.exit();
                const terminal = this.pendingTerminal;
                if (terminal) {
                    terminal.writer.enqueue(terminal.sessionId, { type: "session_error", error: terminal.error });
                    terminal.writer.closeSession(terminal.sessionId, {
                        type: "response",
                        command: "close_session",
                        success: false,
                        error: terminal.error,
                    });
                }
                resolve();`

function apply(path, pairs, label) {
  if (!existsSync(path)) return
  const original = readFileSync(path, "utf8")
  let source = original
  for (const [before, after] of pairs) {
    if (source.includes(after)) continue
    if (!source.includes(before)) throw new Error(`omo-ai: unsupported Senpi ${label}`)
    source = source.replace(before, after)
  }
  if (source !== original) writeFileSync(path, source)
}

/**
 * Repeated shutdown callers join one disposal instead of exiting through it.
 * The first failing exit code wins, so a serializer failure is never masked by a
 * later EOF shutdown, and the process exits only once teardown has settled.
 * Indentation is derived from the declaration: the published engine is compiled
 * with four spaces, the Bun-transpiled engine source with two.
 */
function patchRpcModeShutdown(path) {
  if (!existsSync(path)) return
  const original = readFileSync(path, "utf8")
  if (original.includes("let shutdownCompletion")) return
  const declaration = /^(?<indent>[ \t]*)let shuttingDown = false;$/m.exec(original)
  if (declaration?.groups === undefined) throw new Error("omo-ai: unsupported Senpi rpc-mode.js shutdown join")
  const outer = declaration.groups.indent
  const unit = outer.includes("\t") ? "\t" : outer
  const inner = outer + unit
  const nested = inner + unit
  const deep = nested + unit
  const before = [
    `${outer}async function shutdown(exitCode = 0, signal) {`,
    `${inner}if (shuttingDown) {`,
    `${nested}process.exit(exitCode);`,
    `${inner}}`,
    `${inner}shuttingDown = true;`,
    `${inner}for (const cleanup of signalCleanupHandlers) {`,
    `${nested}cleanup();`,
    `${inner}}`,
    `${inner}await handler.dispose();`,
    `${inner}detachInput();`,
    `${inner}process.stdin.pause();`,
    `${inner}if (signal !== "SIGTERM") {`,
    `${nested}await flushRawStdout();`,
    `${inner}}`,
    `${inner}process.exit(exitCode);`,
    `${outer}}`,
  ].join("\n")
  if (!original.includes(before)) throw new Error("omo-ai: unsupported Senpi rpc-mode.js shutdown join")
  const after = [
    `${outer}async function shutdown(exitCode = 0, signal) {`,
    `${inner}if (shutdownExitCode === 0)`,
    `${nested}shutdownExitCode = exitCode;`,
    `${inner}if (shutdownCompletion === undefined) {`,
    `${nested}shutdownCompletion = (async () => {`,
    `${deep}for (const cleanup of signalCleanupHandlers) {`,
    `${deep}${unit}cleanup();`,
    `${deep}}`,
    `${deep}await handler.dispose();`,
    `${deep}detachInput();`,
    `${deep}process.stdin.pause();`,
    `${deep}if (signal !== "SIGTERM") {`,
    `${deep}${unit}await flushRawStdout();`,
    `${deep}}`,
    `${nested}})();`,
    `${inner}}`,
    `${inner}await shutdownCompletion;`,
    `${inner}process.exit(shutdownExitCode);`,
    `${outer}}`,
  ].join("\n")
  writeFileSync(
    path,
    original
      .replace(before, after)
      .replace(`${outer}let shuttingDown = false;`, `${outer}let shutdownCompletion;\n${outer}let shutdownExitCode = 0;`),
  )
}

/** Preserve worker ownership until exit before any path publishes terminal records. */
export function patchRpcCloseOrdering(senpiRoot) {
  const rpcRoot = join(senpiRoot, "dist", "modes", "rpc")
  if (!existsSync(rpcRoot)) return
  apply(join(rpcRoot, "worker-session-registry.js"), [[registryBefore, registryAfter]], "worker-session-registry.js close lifecycle")
  apply(join(rpcRoot, "session-worker-client.js"), [[failBefore, failAfter], [exitBefore, exitAfter]], "session-worker-client.js failure publication")
  patchRpcModeShutdown(join(rpcRoot, "rpc-mode.js"))
}
