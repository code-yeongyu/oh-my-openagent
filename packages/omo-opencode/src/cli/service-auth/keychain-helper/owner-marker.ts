export type MarkerProbe = (
  service: string,
  account: string,
  keychain?: string,
) => Promise<"helper-owned" | "other" | "absent" | "unknown">

const MARKER_LINE = /^\s*"gena"<blob>="omo-owner\/1"\s*$/m
const ITEM_NOT_FOUND = 44

/**
 * Whether `<A>` carries the helper's `omo-owner/1` marker, read WITHOUT the helper (addendum row 9b): an attribute-only
 * `security find-generic-password` lookup. It never passes `-w`/`-g`, so the secret is never read and no dialog can
 * appear (attribute reads are silent for any identity, design 8 m2).
 */
export const probeOwnerMarker: MarkerProbe = async (service, account, keychain) => {
  const args = ["find-generic-password", "-s", service, "-a", account, ...(keychain === undefined ? [] : [keychain])]
  const child = Bun.spawn(["/usr/bin/security", ...args], {
    stdout: "pipe",
    stderr: "ignore",
    env: process.env.HOME === undefined ? {} : { HOME: process.env.HOME },
  })
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code === ITEM_NOT_FOUND) return "absent"
  if (code !== 0) return "unknown"
  return MARKER_LINE.test(stdout) ? "helper-owned" : "other"
}
