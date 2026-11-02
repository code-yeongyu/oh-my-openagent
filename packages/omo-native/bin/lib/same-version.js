// npm normalizes a published version (`2026.11.02-1` -> `2026.11.2-1`) but the tarball keeps the
// manifest it was packed with, so an installed engine can report a zero-padded spelling of the exact pin.
// Two versions are the same release when they match after dropping build metadata and leading zeros
// from every numeric identifier.
function normalize(version) {
  const [core = "", ...pre] = String(version).trim().replace(/^v/, "").split("+")[0].split("-")
  const numeric = (part) => (/^\d+$/.test(part) ? String(Number.parseInt(part, 10)) : part)
  const release = core.split(".").map(numeric).join(".")
  const prerelease = pre.join("-").split(".").filter((part) => part !== "").map(numeric).join(".")
  return prerelease === "" ? release : `${release}-${prerelease}`
}

export function sameVersion(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false
  return normalize(left) === normalize(right)
}
