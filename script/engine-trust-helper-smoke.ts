// Release smoke for the signed macOS engine trust helper (omo#10762): the helper's stdout, read from stdin here,
// must pass the production strict decoder. Exit 1 on any malformed document.
import { decodeMacTrustHelperOutput } from "../packages/omo-native/macos-trust-helper"

const decoded = decodeMacTrustHelperOutput(new Uint8Array(await Bun.stdin.arrayBuffer()))
if (decoded.kind !== "decoded") {
  console.error(`::error::the engine trust helper wrote malformed output: ${decoded.check} at ${decoded.path}`)
  process.exit(1)
}
const { facts, sources } = decoded.document
const outcomes = sources.map((source) => `${source.name}=${source.outcome}`).join(" ")
console.log(`engine trust helper: ${facts.certificates.length} certificate(s), complete=${facts.complete}, ${outcomes}`)
