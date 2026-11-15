import { randomUUID } from "node:crypto"
import { rename, rm, writeFile } from "node:fs/promises"

import { readTextIfPresentAsync, type DurableJsonFsAsync } from "../durable-json"
import { registerStoreIndex } from "../store-index"

// The concurrency test proves the index lock loses no registration across processes. Crash durability is
// durable-json's own contract and tests; here it would only add two fsyncs per write, and on a loaded
// receipt host those flushes - not the lock - decided whether 800 serialized writes fit the test's budget
// (#11692). The staged-write-then-rename replace is kept, so readers still never see a torn index.
const atomicReplaceFs: DurableJsonFsAsync = {
  read: readTextIfPresentAsync,
  write: async (path, text) => {
    const staging = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(staging, text, { mode: 0o600 })
    try {
      await rename(staging, path)
    } catch (error) {
      await rm(staging, { force: true })
      throw error
    }
  },
}

const [indexPath, prefix, count] = process.argv.slice(2)
if (indexPath === undefined || prefix === undefined || count === undefined) {
  throw new Error("usage: register-stores.ts <indexPath> <prefix> <count>")
}
for (let index = 0; index < Number(count); index += 1) {
  await registerStoreIndex({ indexPath, storeDir: `/stores/${prefix}-${index}`, now: Date.now, fs: atomicReplaceFs })
}
