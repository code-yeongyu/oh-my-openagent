#!/usr/bin/env node
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = dirname(scriptDir)

export const DAEMON_LAUNCH_SPEC_FILENAME = "daemon-launch-spec.json"

/**
 * The ONE daemon launch profile. Paths are relative to this spec file so the
 * same bytes work from the npm package, the compiled binary's embedded plugin,
 * and the desktop's resolved plugin dir. Never interpolate cwd, hostname, or
 * process.env into this document.
 *
 * `./extensions/omo-member.js` must stay aligned with
 * senpi-task MEMBER_EXTENSION_BUNDLE_NAME.
 */
export function daemonLaunchSpecDocument() {
  return {
    spec_version: 1,
    core: {
      session_runtime: "in-process",
      multi_session: true,
      extensions: [".", "./extensions/omo-member.js"],
    },
    tunables: {
      idleExitMs: 900000,
      coldStart: "transient",
    },
    env: {
      OMO_NATIVE: "1",
    },
  }
}

export function renderDaemonLaunchSpec() {
  return `${JSON.stringify(daemonLaunchSpecDocument(), null, 2)}\n`
}

export function resolveDaemonLaunchSpecOutput(env = process.env) {
  const targetRoot = env.OMO_SENPI_PLUGIN_OUTPUT === undefined ? pluginRoot : env.OMO_SENPI_PLUGIN_OUTPUT
  return join(targetRoot, DAEMON_LAUNCH_SPEC_FILENAME)
}

export async function buildDaemonLaunchSpec(options = {}) {
  const output = options.outputPath ?? resolveDaemonLaunchSpecOutput()
  await mkdir(dirname(output), { recursive: true })
  const tempPath = `${output}.tmp-${process.pid}`
  try {
    await writeFile(tempPath, renderDaemonLaunchSpec(), { encoding: "utf8", mode: 0o644 })
    await rename(tempPath, output)
  } finally {
    await rm(tempPath, { force: true })
  }
  return { ok: true, output }
}

export async function checkDaemonLaunchSpecCurrent(options = {}) {
  const output = options.outputPath ?? resolveDaemonLaunchSpecOutput()
  let actual
  try {
    actual = await readFile(output, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return { ok: false, reason: "missing-output", output }
    }
    throw error
  }
  if (actual !== renderDaemonLaunchSpec()) {
    return { ok: false, reason: "stale-output", output }
  }
  return { ok: true, output }
}

function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    const result = await checkDaemonLaunchSpecCurrent()
    if (!result.ok) {
      console.error(`omo-senpi daemon launch spec is not current: ${result.reason}`)
      console.error(`output=${result.output}`)
      process.exit(1)
    }
    console.log(`omo-senpi daemon launch spec is current: ${result.output}`)
  } else {
    const result = await buildDaemonLaunchSpec()
    console.log(`Built omo-senpi daemon launch spec: ${result.output}`)
  }
}
