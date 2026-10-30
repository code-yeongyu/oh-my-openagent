import { spawnSync } from "node:child_process"

const NPM_DIST_TAGS_URL = "https://registry.npmjs.org/-/package/omo-ai/dist-tags"
const NPM_FETCH_TIMEOUT_MS = 5000

// The dist-tags of omo-ai, read by `omo doctor` for "Latest" and by `omo update` for the version it
// installs. Doctor is called without await from the launcher and the compiled entry, so the
// registry lookup has to finish before we print. A bounded child fetch keeps that synchronous
// and turns any network failure into null.

function distTagsFetchScript(url, timeoutMs) {
  return `
const url = ${JSON.stringify(url)};
const timeout = ${Number(timeoutMs)};
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), timeout);
fetch(url, { signal: ac.signal, headers: { accept: "application/json" } })
  .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.text(); })
  .then((text) => { JSON.parse(text); process.stdout.write(text); })
  .catch(() => { process.exitCode = 1; })
  .finally(() => { clearTimeout(timer); });
`
}

export function fetchNpmDistTagsSync(options = {}) {
  const spawn = options.spawn ?? spawnSync
  const url = options.url ?? NPM_DIST_TAGS_URL
  const timeoutMs = options.timeoutMs ?? NPM_FETCH_TIMEOUT_MS
  try {
    const result = spawn(process.execPath, ["-e", distTagsFetchScript(url, timeoutMs)], {
      encoding: "utf8",
      timeout: timeoutMs + 500,
      windowsHide: true,
      env: process.env,
    })
    if (result.error || result.status !== 0 || typeof result.stdout !== "string" || result.stdout.trim() === "") return null
    const parsed = JSON.parse(result.stdout)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
