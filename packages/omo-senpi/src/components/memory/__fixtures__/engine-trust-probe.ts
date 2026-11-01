import { prepareTrustDirectory, trustDirectory, TrustStorageError } from "../../../../../omo-native/trust-generation"

try {
  const prepared = await prepareTrustDirectory(trustDirectory(process.env, "linux"), "linux")
  process.stdout.write(JSON.stringify({ ok: true, ...prepared }))
} catch (error) {
  const code = error instanceof TrustStorageError ? error.code : null
  process.stdout.write(JSON.stringify({ ok: false, code, message: error instanceof Error ? error.message : String(error) }))
}
