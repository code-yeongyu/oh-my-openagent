import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

// The import edges between the desktop packages, enforced in each package.json and every src/ file. A package may
// import itself and the packages listed here; no other workspace package.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCOPE = "@oh-my-opencode/"
const DESKTOP = "senpi-desktop-"

const ALLOWED_EDGES = {
  "senpi-desktop-protocol": [],
  "senpi-desktop-prelude": [],
  "senpi-desktop-engine": ["senpi-desktop-protocol"],
  "senpi-desktop-sdk": ["senpi-desktop-protocol"],
  "senpi-desktop-service": ["senpi-desktop-protocol", "senpi-desktop-engine", "senpi-desktop-prelude", "senpi-desktop-sdk"],
  "senpi-desktop-tool": [
    "senpi-desktop-protocol",
    "senpi-desktop-engine",
    "senpi-desktop-prelude",
    "senpi-desktop-service",
    "senpi-desktop-sdk",
  ],
}

// Host-agent packages no desktop package may import (matched as a whole specifier segment).
const FORBIDDEN_HOST_PACKAGES = ["pi-agent-core", "pi-ai", "pi-tui"]

// The SDK has no side effects on import and launches nothing itself: a spawn transport takes an injected launcher.
const SDK_FORBIDDEN_BUILTINS = ["child_process", "net", "tls", "http", "https", "dgram", "cluster", "worker_threads"]

// The one exception: the attach transport connects to the local `--serve` socket its caller names (plan row 25).
const SDK_ALLOWED_BUILTINS = { "packages/senpi-desktop-sdk/src/transport/attach-uds.ts": ["net"] }

const SOURCE = /\.(?:[cm]?ts|[cm]?js)$/
const SPECIFIER =
  /(?:\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?|\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g

function importSpecifiers(text) {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
  return [...withoutComments.matchAll(SPECIFIER)].map((match) => match[1])
}

function workspaceTarget(specifier) {
  if (!specifier.startsWith(SCOPE)) return undefined
  return specifier.slice(SCOPE.length).split("/")[0]
}

function isHostPackage(specifier) {
  return specifier.split("/").some((segment) => FORBIDDEN_HOST_PACKAGES.includes(segment))
}

function isForbiddenBuiltin(file, specifier) {
  const key = file.split(sep).join("/").split("\\").join("/")
  const name = (specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier).split("/")[0]
  return SDK_FORBIDDEN_BUILTINS.includes(name) && !(SDK_ALLOWED_BUILTINS[key] ?? []).includes(name)
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return SOURCE.test(entry.name) ? [path] : []
  })
}

/** Every edge violation of one package: `{ file, specifier, why }`. */
function violationsOf(pkg, root = ROOT) {
  const allowed = new Set([pkg, ...ALLOWED_EDGES[pkg]])
  const dir = join(root, "packages", pkg)
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  const declared = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) =>
    Object.keys(manifest[field] ?? {}).map((name) => ({ file: `packages/${pkg}/package.json`, specifier: name })),
  )
  const imported = sourceFiles(join(dir, "src")).flatMap((file) =>
    importSpecifiers(readFileSync(file, "utf8")).map((specifier) => ({ file: relative(root, file), specifier })),
  )
  const violations = []
  for (const { file, specifier } of [...declared, ...imported]) {
    const target = workspaceTarget(specifier)
    if (target !== undefined && !allowed.has(target)) {
      violations.push({ file, specifier, why: `${pkg} may import only ${[...allowed].join(", ")}` })
    }
    if (isHostPackage(specifier)) violations.push({ file, specifier, why: "desktop packages never import pi-* host packages" })
    if (pkg === "senpi-desktop-sdk" && isForbiddenBuiltin(file, specifier)) {
      violations.push({ file, specifier, why: "the SDK launches and connects nothing itself" })
    }
  }
  return violations
}

test("#given the desktop package set #when listing packages/ #then every senpi-desktop-* package has an edge row", () => {
  const present = readdirSync(join(ROOT, "packages"))
    .filter((name) => name.startsWith(DESKTOP))
    .filter((name) => readdirSync(join(ROOT, "packages", name)).includes("package.json"))
    .sort()

  assert.deepEqual(present, Object.keys(ALLOWED_EDGES).sort())
})

for (const pkg of Object.keys(ALLOWED_EDGES)) {
  test(`#given ${pkg} #when reading package.json and src imports #then only its allowed edges appear`, () => {
    assert.deepEqual(violationsOf(pkg), [])
  })
}

test("#given the sdk edge row #when checked #then the sdk may import -protocol only and -service/-tool may import the sdk", () => {
  assert.deepEqual(ALLOWED_EDGES["senpi-desktop-sdk"], ["senpi-desktop-protocol"])
  assert.ok(ALLOWED_EDGES["senpi-desktop-service"].includes("senpi-desktop-sdk"))
  assert.ok(ALLOWED_EDGES["senpi-desktop-tool"].includes("senpi-desktop-sdk"))
})

test("#given a Windows checkout #when the sdk exception path arrives with win32-style separators #then the exception still matches", () => {
  const win32 = "packages\\senpi-desktop-sdk\\src\\transport\\attach-uds.ts"
  assert.equal(isForbiddenBuiltin(win32, "node:net"), false)
  assert.equal(isForbiddenBuiltin("packages\\senpi-desktop-sdk\\src\\index.ts", "node:net"), true)
})

test("#given import forms #when extracting specifiers #then static, re-export, type, dynamic and require forms are all seen", () => {
  const text = [
    'import { a } from "@oh-my-opencode/senpi-desktop-service"',
    'import type { B } from "@oh-my-opencode/senpi-desktop-tool/registration"',
    'export * from "node:child_process"',
    'export { c } from "@earendil-works/pi-ai"',
    'const d = await import("node:net")',
    'const e = require("./local")',
    'import "./side-effect"',
    '// import { f } from "@oh-my-opencode/omo-senpi"',
    '/* import { g } from "@oh-my-opencode/omo-senpi" */',
  ].join("\n")

  assert.deepEqual(importSpecifiers(text), [
    "@oh-my-opencode/senpi-desktop-service",
    "@oh-my-opencode/senpi-desktop-tool/registration",
    "node:child_process",
    "@earendil-works/pi-ai",
    "node:net",
    "./local",
    "./side-effect",
  ])
})
