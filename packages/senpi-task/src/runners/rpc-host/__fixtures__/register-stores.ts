import { registerStoreIndex } from "../store-index"

const [indexPath, prefix, count] = process.argv.slice(2)
if (indexPath === undefined || prefix === undefined || count === undefined) {
  throw new Error("usage: register-stores.ts <indexPath> <prefix> <count>")
}
for (let index = 0; index < Number(count); index += 1) {
  await registerStoreIndex({ indexPath, storeDir: `/stores/${prefix}-${index}`, now: Date.now })
}
