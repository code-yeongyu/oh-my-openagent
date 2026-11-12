import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { createCodexInstallSandbox } from "./install-test-fixtures.mjs"

// #13253: the Codex installer and cleanup resolve codexHome, the bin dir and the project directory from the real home
// when a caller leaves one out, so a test that forgets one writes or deletes outside its scratch directory. The
// sandbox refuses that by path, before the call runs.

test("#given a sandbox #when options are taken #then every resolvable path is inside its root", () => {
  const sandbox = createCodexInstallSandbox("guard-paths")
  try {
    const options = sandbox.options()
    for (const path of [options.codexHome, options.binDir, options.projectDirectory])
      assert.equal(path.startsWith(sandbox.root), true, `${path} is outside ${sandbox.root}`)
    for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "CODEX_LOCAL_BIN_DIR", "OMO_CODEX_PROJECT"])
      assert.equal(options.env[key].startsWith(sandbox.root), true, `env.${key} is outside the sandbox`)
    // The project-local cleanup walks up to the first .git; the sandbox carries one so the walk ends inside it.
    assert.equal(existsSync(join(options.projectDirectory, ".git")), true)
  } finally {
    sandbox.dispose()
  }
})

test("#given a context with no bin dir #when options are taken #then it is refused", () => {
  const sandbox = createCodexInstallSandbox("guard-bin")
  try {
    assert.throws(() => sandbox.options({ binDir: undefined }), /options\.binDir is missing/)
    assert.throws(() => sandbox.options({ binDir: join(tmpdir(), "outside-bin") }), /outside/)
  } finally {
    sandbox.dispose()
  }
})

test("#given a context with no project directory #when options are taken #then it is refused", () => {
  const sandbox = createCodexInstallSandbox("guard-project")
  try {
    assert.throws(() => sandbox.options({ projectDirectory: undefined }), /options\.projectDirectory is missing/)
    assert.throws(() => sandbox.options({ projectDirectory: homedir() }), /outside/)
  } finally {
    sandbox.dispose()
  }
})

test("#given a spawn environment carrying the real home #when it is built #then it is refused", () => {
  const sandbox = createCodexInstallSandbox("guard-spawn")
  try {
    assert.throws(() => sandbox.spawnEnv({ HOME: homedir() }), /env\.HOME .* is outside/)
    assert.throws(() => sandbox.spawnEnv({ CODEX_HOME: join(homedir(), ".codex") }), /env\.CODEX_HOME .* is outside/)
    const env = sandbox.spawnEnv()
    for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "CODEX_LOCAL_BIN_DIR", "OMO_CODEX_PROJECT"])
      assert.equal(env[key].startsWith(sandbox.root), true)
    assert.equal(
      Object.keys(env).some((key) => key.startsWith("LAZYCODEX_")),
      false,
    )
  } finally {
    sandbox.dispose()
  }
})

test("#given a codex home whose bin dir is derived #when options leave the bin dir out #then the derived path must still be inside", () => {
  const sandbox = createCodexInstallSandbox("guard-derived")
  try {
    const options = sandbox.options({ withoutBinDir: true })
    assert.equal(options.binDir, undefined)
    assert.equal(options.env.CODEX_LOCAL_BIN_DIR, undefined)
    assert.throws(() => sandbox.options({ withoutBinDir: true, codexHome: join(tmpdir(), "outside-home") }), /outside/)
  } finally {
    sandbox.dispose()
  }
})

// #13264 / #13253: every Codex test file that CI runs (the test:codex script and the platform node leg) must reach the
// installer only through the sandbox, so no run can fall back to the real home or send an install event. Read from
// the two lists CI actually runs, so a new file is covered the moment it is added to either.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const INSTALLER_CALLS = [
  "installMarketplaceLocally",
  "runCodexInstaller",
  "cleanupCodexLight",
  "runLazyCodexInstallLocalCli",
  "runLazyCodexManualUpdate",
]

function ciCodexTestFiles() {
  const testCodex = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts["test:codex"]
  const platformNode = readFileSync(join(repoRoot, ".github", "scripts", "ci-codex-platform-node.sh"), "utf8")
  const files = new Set()
  for (const match of `${testCodex} ${platformNode}`.matchAll(/(packages\/[^\s&;]+\.test\.(?:mjs|ts))/g)) {
    const pattern = match[1]
    if (!pattern.includes("*")) {
      files.add(pattern)
      continue
    }
    const suffix = pattern.slice(pattern.lastIndexOf("*") + 1)
    const recursive = pattern.includes("**")
    const directory = recursive ? pattern.slice(0, pattern.indexOf("/**")) : dirname(pattern)
    for (const name of readdirSync(join(repoRoot, directory), { recursive }))
      if (String(name).endsWith(suffix)) files.add(join(directory, String(name)))
  }
  return [...files].filter((file) => existsSync(join(repoRoot, file)))
}

function balancedCall(text, openParen) {
  let depth = 0
  for (let index = openParen; index < text.length; index++) {
    if (text[index] === "(") depth++
    else if (text[index] === ")" && --depth === 0) return text.slice(openParen, index + 1)
  }
  return text.slice(openParen)
}

export function installerCallsOutsideSandbox(file, text) {
  const lineOf = (index) => text.slice(0, index).split("\n").length
  const found = []
  for (const name of INSTALLER_CALLS)
    for (const match of text.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g"))) {
      if (/function\s*$/.test(text.slice(Math.max(0, match.index - 20), match.index))) continue
      if (!/^\(\s*sandbox\.options\(/.test(balancedCall(text, match.index + match[0].length - 1)))
        found.push(`${file}:${lineOf(match.index)} ${name} without sandbox.options()`)
    }
  // A file that names the installer's CLI entry spawns it, so every spawn there gets the sandbox's complete environment.
  if (/["'`]\.\/install-local\.mjs["'`]/.test(text))
    for (const match of text.matchAll(/\b(execFileSync|execFile|spawnSync|spawn|execSync)\s*\(/g)) {
      const call = balancedCall(text, match.index + match[0].length - 1)
      if (!/env:\s*(?:\{\s*\.\.\.)?sandbox\.spawnEnv\(/.test(call))
        found.push(`${file}:${lineOf(match.index)} ${match[1]} without sandbox.spawnEnv()`)
    }
  return found
}

test("#given every Codex test file CI runs #when scanned #then each installer call or spawn goes through the sandbox", () => {
  const files = ciCodexTestFiles()
  assert.equal(files.length > 100, true, `expected the CI lists to name the Codex test files, got ${files.length}`)
  const outside = files.flatMap((file) =>
    installerCallsOutsideSandbox(file, readFileSync(join(repoRoot, file), "utf8")),
  )
  assert.deepEqual(outside, [])
})

test("#given a test that calls or spawns the installer outside the sandbox #when scanned #then it is reported", () => {
  // Built from parts so this file's own text holds no bare installer call or spawn.
  const bareCall = ["await installMarketplaceLocally", "({ repoRoot, codexHome })\n"].join("")
  const bareSpawn = [
    'const scriptPath = "./install-local.mjs"\n',
    "execFileSync",
    '(process.execPath, [scriptPath, "--version"], { encoding: "utf8" })\n',
  ].join("")
  assert.deepEqual(installerCallsOutsideSandbox("fixture.test.mjs", bareCall), [
    "fixture.test.mjs:1 installMarketplaceLocally without sandbox.options()",
  ])
  assert.deepEqual(installerCallsOutsideSandbox("fixture.test.mjs", bareSpawn), [
    "fixture.test.mjs:2 execFileSync without sandbox.spawnEnv()",
  ])
})
