import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const eventSourceChanges = [
  ['\tif (message.kind !== "watch") return;', '\tif (message.kind !== "watch") return;\n\tif (Atomics.load(message.active, 0) === 0) return;'],
  ['replacement.postMessage({ kind: "watch", id, path: subscription.path, recursive: subscription.recursive });', 'replacement.postMessage({ kind: "watch", id, path: subscription.path, recursive: subscription.recursive, active: subscription.active });'],
  [`            ensureRecursiveWorker().postMessage({ kind: "watch", id, path, recursive });
            recursiveSubscriptions.set(id, { path, listener, recursive });`,
   `            const active = new Int32Array(new SharedArrayBuffer(4));
            Atomics.store(active, 0, 1);
            ensureRecursiveWorker().postMessage({ kind: "watch", id, path, recursive, active });
            recursiveSubscriptions.set(id, { path, listener, recursive, active });
            let closing;`],
  [`                if (!recursiveSubscriptions.delete(id))
                    return;`,
   `                if (!recursiveSubscriptions.delete(id))
                    return closing;
                Atomics.store(active, 0, 0);`],
  ['                void worker.terminate().catch((error) => onError(error, path));',
   `                closing = worker.terminate().catch((error) => {
                    onError(error, path);
                    throw error;
                });
                return closing;`],
]

const engineChanges = [
  ['    #closed = false;', '    #closed = false;\n    #closeCompletion;'],
  [`        if (this.#closed) {
            return Promise.resolve();
        }`,
   `        if (this.#closed) {
            return this.#closeCompletion;
        }`],
  [`        return new Promise((settle) => {
            this.#clock.setTimeout(() => {
                for (const unsubscribe of unsubscribes) {
                    try {
                        unsubscribe();
                    }
                    catch (error) {
                        this.#reportError(error, "watch subscription");
                    }
                }
                settle();
            }, 0);
        });`,
   `        // Cancel queued registrations synchronously; await every native disposer.
        this.#closeCompletion = Promise.allSettled(unsubscribes.map(async (unsubscribe) => unsubscribe()))
            .then((results) => {
                const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
                if (errors.length > 0)
                    throw new AggregateError(errors, "Config watcher teardown failed");
            });
        return this.#closeCompletion;`],
]

const extensionChanges = [
  ['    let engine;', '    let engine;\n    const watcherClosures = [];'],
  [`        engine?.close().catch((error) => {
            logger.error("watcher_error", { path: "watcher teardown", message: errorMessage(error) });
        });`,
   `        if (engine)
            watcherClosures.push(Promise.allSettled([engine.close()]));`],
  [`    const processChange = async (change) => {
        if (reloadInFlight || !currentContext)
            return;`,
   `    const processChange = async (change) => {
        if (reloadInFlight || !currentContext || !started)
            return;
        const changeContext = currentContext;`],
  ['            const errors = await validateChangedPaths(registrationId, paths, registrations, agentDir, currentContext.cwd);',
   `            const errors = await validateChangedPaths(registrationId, paths, registrations, agentDir, currentContext.cwd);
            if (!started || currentContext !== changeContext)
                return;`],
  ['    const rebuildWatchers = (ctx) => {\n        closeWatchers();',
   '    const rebuildWatchers = (ctx) => {\n        if (!started || currentContext !== ctx) return;\n        closeWatchers();'],
  ['        if (!settings.enabled || ctx.mode === "print" || ctx.mode === "json") {',
   `        // Nonpersistent RPC probes need a configuration snapshot, not live OS watches.
        if (!settings.enabled || ctx.mode === "print" || ctx.mode === "json" ||
            (ctx.mode === "rpc" && ctx.sessionManager.getSessionFile() === undefined)) {`],
  ['    pi.on("agent_end", async (_event, ctx) => {\n        currentContext = ctx;',
   '    pi.on("agent_end", async (_event, ctx) => {\n        if (!started) return;\n        currentContext = ctx;'],
  ['    pi.on("agent_settled", async (_event, ctx) => {\n        currentContext = ctx;',
   '    pi.on("agent_settled", async (_event, ctx) => {\n        if (!started) return;\n        currentContext = ctx;'],
  ['    pi.on("session_shutdown", (event) => {', '    pi.on("session_shutdown", async (event) => {'],
  [`        if (event.reason !== "reload" && closingContext)
            reloadHandoffs.delete(handoffKey(closingContext));`,
   `        if (event.reason !== "reload" && closingContext)
            reloadHandoffs.delete(handoffKey(closingContext));
        const results = (await Promise.all(watcherClosures)).flat();
        const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
        if (errors.length > 0)
            throw new AggregateError(errors, "Config watcher shutdown failed");`],
]

/** Bridge the pinned engine's watcher cancellation and asynchronous disposal contract. */
export function patchWatcherShutdown(senpiRoot) {
  const root = join(senpiRoot, "dist/core/extensions/builtin/config-reload")
  if (!existsSync(root)) return
  for (const [name, changes] of [
    ["watch-event-source.js", eventSourceChanges],
    ["watch-engine.js", engineChanges],
    ["index.js", extensionChanges],
  ]) {
    const path = join(root, name)
    const original = readFileSync(path, "utf8")
    let source = original
    for (const [before, after] of changes) {
      if (source.includes(after)) continue
      if (!source.includes(before)) throw new Error(`omo-ai: unsupported Senpi config-reload/${name} shutdown lifecycle`)
      source = source.replace(before, after)
    }
    if (source !== original) writeFileSync(path, source)
  }
}
