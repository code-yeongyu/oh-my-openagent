import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { declarationDigest, policyHash } from "./project-env-policy"

// Shared verbatim data fixture: senpi a747be4db1, 3796-declaration-digest.test.ts.
const identity = {
  sourcePath: "/fixture/project/skills/a/mcp.json",
  sourceKind: "sidecar" as const,
  projectRoot: "/fixture/project",
  serverName: "probe",
  raw: {
    type: "stdio" as const,
    command: "tool",
    args: ["--serve"],
    cwd: "./work",
    env: { TOKEN: "${TOKEN}", NODE_OPTIONS: "--no-warnings" },
  },
  cwdBase: "/fixture/project",
}
const expected = "a82aa53bdc6ae462ccbe72166353100b4dbf4fc6d07dfea01d12dc9c1f8f3c63"

test("legacy and native use the same shared declaration hash fixture", () => {
  expect(policyHash(identity)).toBe(expected)
  expect(policyHash({
    cwdBase: identity.cwdBase, raw: {
      env: { NODE_OPTIONS: "--no-warnings", TOKEN: "${TOKEN}" },
      cwd: "./work", args: ["--serve"], command: "tool", type: "stdio",
    },
    serverName: "probe", projectRoot: identity.projectRoot, sourceKind: "sidecar", sourcePath: identity.sourcePath,
  })).toBe(expected)
})

test("legacy declaration construction uses the exact shared field schema", () => {
  const canonical = {
    ...identity, sourcePath: resolve(identity.sourcePath),
    projectRoot: resolve(identity.projectRoot), cwdBase: resolve(identity.cwdBase),
  }
  expect(declarationDigest({
    sessionID: "fixture", skillName: "fixture", serverName: "probe",
    sourcePath: identity.sourcePath, sourceKind: identity.sourceKind, directory: identity.cwdBase,
    provenance: { kind: "project-auto", selectedRoot: identity.sourcePath, projectRoot: identity.projectRoot },
  }, identity.raw)).toBe(policyHash(canonical))
})

test.each(["command", "env", "url", "sourceKind", "cwdBase"])("shared declaration identity changes with %s", (field) => {
  const changed = field === "command" ? { ...identity, raw: { ...identity.raw, command: "other" } } :
    field === "env" ? { ...identity, raw: { ...identity.raw, env: { ...identity.raw.env, NODE_OPTIONS: "--trace-warnings" } } } :
    field === "url" ? { ...identity, raw: { ...identity.raw, url: "https://fixture.invalid/mcp" } } :
    field === "sourceKind" ? { ...identity, sourceKind: "frontmatter" } : { ...identity, cwdBase: "/fixture/other" }
  expect(policyHash(changed)).not.toBe(expected)
})
