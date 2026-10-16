// Preloaded into a launcher child: any OS credential-store access is reported on stderr and refused.
const touched = () => {
  process.stderr.write("KEYSTORE_TOUCHED\n")
  throw new Error("credential store must not be touched while OmO accounts are closed")
}
Object.defineProperty(Bun, "secrets", { value: { get: touched, set: touched, delete: touched } })
