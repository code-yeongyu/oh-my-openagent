import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"
import type { SenpiExtensionAPI } from "../../extension/types"
import { RECALL_OPENERS } from "./recall-openers"
import { registerMemoryReadClassifier } from "./read-classifier-wiring"
import { createMemoryComponent, memoryModuleSupervisor } from "./index"
import { componentContext, loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI, sessionContext } from "./memory.test-support"

type ReadClassifier = Parameters<NonNullable<SenpiExtensionAPI["registerReadClassifier"]>>[0]

class ReadClassifierHost extends MemoryFakeExtensionAPI {
  readonly classifiers: ReadClassifier[] = []
  unregisterCount = 0

  registerReadClassifier(classifier: ReadClassifier): () => void {
    this.classifiers.push(classifier)
    return () => {
      this.unregisterCount += 1
      this.classifiers.splice(this.classifiers.indexOf(classifier), 1)
    }
  }
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-read-classifier-"))
  roots.push(root)
  const repo = join(root, "agents", "test", "repo")
  mkdirSync(join(repo, "reference", "project"), { recursive: true })
  writeFileSync(join(repo, "reference", "project", "foo.md"), "fixture")
  mkdirSync(join(repo, ".git"))
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main")
  const pi = new ReadClassifierHost()
  const repos = new Set([repo])
  const unregister = registerMemoryReadClassifier(pi, { resolveRepos: () => repos })
  const classifier = pi.classifiers[0]
  if (classifier === undefined) throw new Error("classifier was not registered")
  return { root, repo, pi, repos, unregister, classify: (absolutePath: string) => classifier({ absolutePath, cwd: root }) }
}

describe("registerMemoryReadClassifier", () => {
  test("#given a bound repo #when reading a nested file #then it returns memory with a relative label and a pool headline", () => {
    const { repo, classify } = fixture()
    const result = classify(join(repo, "reference", "project", "foo.md"))
    expect(result).toEqual({ kind: "memory", label: "reference/project/foo.md", headline: expect.any(String) })
    expect(RECALL_OPENERS.some((opener) => opener === result?.headline)).toBe(true)
  })

  test("#given an outside path or a sibling with the repo prefix #when classified #then it is not memory", () => {
    const { root, repo, classify } = fixture()
    expect(classify(join(root, "other.md"))).toBeUndefined()
    expect(classify(join(`${repo}-other`, "foo.md"))).toBeUndefined()
    expect(classify(join(repo, "..", "foo.md"))).toBeUndefined()
  })

  test("#given git metadata #when read directly or through a symlink #then it is excluded", () => {
    const { repo, classify } = fixture()
    symlinkSync(join(repo, ".git"), join(repo, "metadata"), "junction")
    expect(classify(join(repo, ".git", "HEAD"))).toBeUndefined()
    expect(classify(join(repo, "metadata", "HEAD"))).toBeUndefined()
  })

  test("#given symlinked repo paths #when lexical and real paths are read #then both resolve to the same label", () => {
    const { root, repo, repos, classify } = fixture()
    const alias = join(root, "repo-link")
    symlinkSync(repo, alias, "junction")
    repos.clear()
    repos.add(alias)
    expect(classify(join(repo, "reference", "project", "foo.md"))?.label).toBe("reference/project/foo.md")
    expect(classify(join(alias, "reference", "project", "foo.md"))?.label).toBe("reference/project/foo.md")
  })

  test("#given a symlink escaping the repo #when read #then it is not memory", () => {
    const { root, repo, classify } = fixture()
    const outside = join(root, "outside")
    mkdirSync(outside)
    writeFileSync(join(outside, "foo.md"), "outside")
    symlinkSync(outside, join(repo, "escape"), "junction")
    expect(classify(join(repo, "escape", "foo.md"))).toBeUndefined()
  })

  test("#given a not-yet-created file #when lexical paths normalize inside a bound repo #then it is classified", () => {
    const { repo, classify } = fixture()
    expect(classify(join(repo, "reference", "..", "new.md"))?.label).toBe("new.md")
  })

  test("#given changing bound identities #when classified #then live repos are used and one picker spans identities", () => {
    spyOn(Math, "random").mockReturnValue(0)
    const { root, repo, pi, repos, classify } = fixture()
    const other = join(root, "second-repo")
    repos.add(other)
    const first = classify(join(repo, "one.md"))
    const second = classify(join(other, "two.md"))
    expect(RECALL_OPENERS.some((opener) => opener === first?.headline)).toBe(true)
    expect(RECALL_OPENERS.some((opener) => opener === second?.headline)).toBe(true)
    expect(second?.headline).not.toBe(first?.headline)
    expect(second?.label).toBe("two.md")
    repos.delete(repo)
    expect(classify(join(repo, "one.md"))).toBeUndefined()
    expect(pi.classifiers).toHaveLength(1)
  })

  test("#given a legacy host #when registration is requested #then it logs debug and does not resolve repositories", () => {
    const pi = new MemoryFakeExtensionAPI()
    const resolveRepos = mock(() => [])
    const debug = mock(() => {})
    const unregister = registerMemoryReadClassifier(pi, {
      resolveRepos,
      logger: { ...componentContext().logger, debug },
    })
    expect(unregister).toBeUndefined()
    expect(resolveRepos).not.toHaveBeenCalled()
    expect(debug).toHaveBeenCalledTimes(1)
    expect(pi.handlers).toHaveLength(0)
  })

  test("#given a registered classifier #when disposed #then the host unregisters it", () => {
    const { pi, unregister } = fixture()
    unregister?.()
    expect(pi.classifiers).toHaveLength(0)
    expect(pi.unregisterCount).toBe(1)
  })
})

describe("memory read classifier component lifecycle", () => {
  test("#given a capable host #when the component registers and shuts down #then one classifier is registered and removed", async () => {
    const pi = new ReadClassifierHost()
    const component = createMemoryComponent({
      env: {},
      loadConfig: () => loadedMemoryConfig(memorySettings()),
    })

    component.register(pi, componentContext())

    expect(pi.classifiers).toHaveLength(1)
    await pi.dispatch("session_shutdown", { reason: "quit" }, sessionContext())
    expect(pi.classifiers).toHaveLength(0)
    expect(pi.unregisterCount).toBe(1)
  })

  test("#given a session binding #when the runtime is unavailable #then classification still uses the bound identity repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "memory-read-binding-"))
    roots.push(root)
    const env = { OMO_MEMORY_HOME: join(root, "memory") }
    const pi = new ReadClassifierHost()
    const identity = resolveMemoryIdentity("test", root, env)
    createMemoryComponent({
      env,
      resolveCwd: () => root,
      loadConfig: () => loadedMemoryConfig(memorySettings({ agent: "test" })),
      createRuntime: () => { throw new Error("bind-only fixture: runtime unavailable") },
    }).register(pi, componentContext())
    const classify = pi.classifiers[0]
    if (classify === undefined) throw new Error("classifier was not registered")
    const input = { absolutePath: join(identity.paths.repo, "reference", "bound.md"), cwd: root }
    expect(classify(input)).toBeUndefined()

    await pi.dispatch("session_start", {}, sessionContext())
    try {
      expect(classify(input)).toEqual({ kind: "memory", label: "reference/bound.md", headline: expect.any(String) })
    } finally {
      memoryModuleSupervisor.release()
    }
  })

  test("#given a legacy host #when the component registers #then it remains usable without the classifier API", () => {
    const pi = new MemoryFakeExtensionAPI()
    expect(() => createMemoryComponent({
      env: {},
      loadConfig: () => loadedMemoryConfig(memorySettings()),
    }).register(pi, componentContext())).not.toThrow()
    expect(pi.tools.length).toBeGreaterThan(0)
  })
})
