import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const before = `        // Reply on a bounded deadline, but keep entry, attachments and reservations until exit.
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
const after = `        // The worker deadline requests termination; only exit releases registry ownership.
        await entry.worker.close(this.closeGraceMs);`

/** Preserve worker ownership until exit before the router publishes terminal records. */
export function patchRpcCloseOrdering(senpiRoot) {
  const rpcRoot = join(senpiRoot, "dist", "modes", "rpc")
  if (!existsSync(rpcRoot)) return
  const path = join(rpcRoot, "worker-session-registry.js")
  if (!existsSync(path)) return
  const source = readFileSync(path, "utf8")
  if (source.includes(after)) return
  if (!source.includes(before)) throw new Error("omo-ai: unsupported Senpi worker-session-registry.js close lifecycle")
  writeFileSync(path, source.replace(before, after))
}
