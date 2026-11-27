import { runTrustStage } from "../../trust-stage"

// A real process that runs `trust ensure` and exits, so its exit handlers run before the test reads the lease.
const [directory, ...args] = process.argv.slice(2)
if (directory === undefined) throw new Error("usage: trust-ensure-probe <directory> <args...>")
const result = await runTrustStage({
  args, directory, env: {}, loadedExtra: () => [],
  acquire: async () => ({ certificates: [], fallbackReason: null, codes: [] }),
  exec: async () => { throw new Error("trust ensure must never exec") },
})
if (result.action !== "ensure") process.exitCode = 1
