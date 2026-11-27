/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import {
  COMMIT_ATTRIBUTION_OPEN_TAG,
  GIT_ENV_PREFIX_OPEN_TAG,
  SISYPHUS_CO_AUTHOR_TRAILER,
  injectGitMasterConfig,
} from "./git-master-template-injection"

const TEMPLATE = "---\nname: git\ndescription: fixture\n---\n# Git\n\nBody.\n"

/** Dynamic fixture: a footer value no shipped default contains. */
const FOOTER_FIXTURE = "FOOTER_PROPAGATION_SENTINEL_9d41"

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

function commitExample(rendered: string): string {
  const example = /`([^`]*\bgit\b[^`]* commit -m [^`]*)`/.exec(rendered)?.[1]
  if (example === undefined) throw new Error("rendered skill carries no commit example")
  return example
}

describe("#given git_env_prefix config", () => {
  describe("#when default config (GIT_MASTER=1)", () => {
    it("#then one prefix block follows the frontmatter and carries both the env form and the line form", () => {
      const result = injectGitMasterConfig(TEMPLATE, undefined, "unix")

      expect(result.startsWith("---\nname: git\ndescription: fixture\n---\n")).toBe(true)
      expect(occurrences(result, GIT_ENV_PREFIX_OPEN_TAG)).toBe(1)
      expect(result.indexOf(GIT_ENV_PREFIX_OPEN_TAG)).toBeLessThan(result.indexOf("# Git"))
      expect(result).toContain('GIT_MASTER: "1"')
      expect(result).toContain("GIT_MASTER=1 git")
    })
  })

  describe("#when git_env_prefix is a custom value with two assignments", () => {
    it("#then both assignments reach the env form and the line form", () => {
      const result = injectGitMasterConfig(
        TEMPLATE,
        { commit_footer: false, include_co_authored_by: false, git_env_prefix: "OMO_GIT=7 TRACE_GIT=on" },
        "unix",
      )

      expect(result).toContain('OMO_GIT: "7", TRACE_GIT: "on"')
      expect(result).toContain("OMO_GIT=7 TRACE_GIT=on git")
      expect(result).not.toContain("GIT_MASTER")
    })
  })

  describe("#when git_env_prefix is empty string", () => {
    it("#then no prefix block is injected", () => {
      const result = injectGitMasterConfig(
        TEMPLATE,
        { commit_footer: false, include_co_authored_by: false, git_env_prefix: "" },
        "unix",
      )

      expect(result).toBe(TEMPLATE)
    })
  })

  describe("#when git_env_prefix contains shell metacharacters", () => {
    it("#then rejects the malicious value", () => {
      expect(() =>
        injectGitMasterConfig(
          TEMPLATE,
          { commit_footer: false, include_co_authored_by: false, git_env_prefix: "A=1; rm -rf /" },
          "unix",
        ),
      ).toThrow()
    })
  })
})

describe("#given commit attribution settings", () => {
  describe("#when no config is provided", () => {
    it("#then one directive ships a prefixed commit example with the co-author trailer and no footer", () => {
      const result = injectGitMasterConfig(TEMPLATE, undefined, "unix")
      const example = commitExample(result)

      expect(occurrences(result, COMMIT_ATTRIBUTION_OPEN_TAG)).toBe(1)
      expect(example.startsWith("GIT_MASTER=1 git -c trailer.ifexists=addIfDifferent commit")).toBe(true)
      expect(occurrences(example, `--trailer "${SISYPHUS_CO_AUTHOR_TRAILER}"`)).toBe(1)
      expect(result).not.toContain("Ultraworked with")
    })
  })

  describe("#when the footer is a string and the co-author is on", () => {
    it("#then the example carries the footer and one trailer", () => {
      const result = injectGitMasterConfig(
        TEMPLATE,
        { commit_footer: FOOTER_FIXTURE, include_co_authored_by: true, git_env_prefix: "GIT_MASTER=1" },
        "unix",
      )
      const example = commitExample(result)

      expect(example).toContain(`-m "${FOOTER_FIXTURE}"`)
      expect(occurrences(example, `--trailer "${SISYPHUS_CO_AUTHOR_TRAILER}"`)).toBe(1)
    })
  })

  describe("#when the env prefix is disabled and only the footer is on", () => {
    it("#then the example is unprefixed, carries the footer, and names no co-author", () => {
      const result = injectGitMasterConfig(
        TEMPLATE,
        { commit_footer: FOOTER_FIXTURE, include_co_authored_by: false, git_env_prefix: "" },
        "unix",
      )
      const example = commitExample(result)

      expect(example.startsWith("git commit")).toBe(true)
      expect(example).toContain(`-m "${FOOTER_FIXTURE}"`)
      expect(result).not.toContain("sisyphus-dev-ai")
    })
  })

  describe("#when include_co_authored_by is false and the footer is off", () => {
    it("#then no attribution directive is injected", () => {
      const result = injectGitMasterConfig(
        TEMPLATE,
        { commit_footer: false, include_co_authored_by: false, git_env_prefix: "GIT_MASTER=1" },
        "unix",
      )

      expect(result).not.toContain(COMMIT_ATTRIBUTION_OPEN_TAG)
    })
  })
})

describe("#given an already injected skill", () => {
  it("#then injecting again changes nothing", () => {
    const once = injectGitMasterConfig(TEMPLATE, undefined, "unix")

    expect(injectGitMasterConfig(once, undefined, "unix")).toBe(once)
  })
})
