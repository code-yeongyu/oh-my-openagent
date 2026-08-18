import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  insertSenpiCompatibilityGuidance,
  senpiHarnessToolCompatibility,
} from "./senpi-compatibility-guidance.mjs"

describe("insertSenpiCompatibilityGuidance", () => {
  test("#given content with no opencode orchestration calls #when processed #then it is returned unchanged", () => {
    const content = "---\nname: test\n---\n\n# Test Skill\n\nNo orchestration here.\n"
    assert.equal(insertSenpiCompatibilityGuidance(content), content)
  })

  test("#given content with an opencode call_omo_agent example #when processed #then the compatibility banner is inserted after frontmatter", () => {
    const content = "---\nname: test\n---\n\n# Test Skill\n\ncall_omo_agent(subagent_type=\"explore\")\n"
    const result = insertSenpiCompatibilityGuidance(content)
    assert.ok(result.includes("## Senpi Harness Tool Compatibility"), "banner must be present")
    assert.ok(result.startsWith("---\nname: test\n---\n"), "frontmatter must be preserved at start")
    const bannerIndex = result.indexOf("## Senpi Harness Tool Compatibility")
    const exampleIndex = result.indexOf('call_omo_agent(subagent_type="explore")')
    assert.ok(bannerIndex < exampleIndex, "banner must precede the first opencode example")
  })

  test("#given content with a pre-existing banner before the first example #when processed #then it is left in place", () => {
    const banner = senpiHarnessToolCompatibility
    const content = `---\nname: test\n---\n${banner}# Test Skill\n\ncall_omo_agent(subagent_type="explore")\n`
    const result = insertSenpiCompatibilityGuidance(content)
    assert.equal(result, content, "content with existing banner must be unchanged")
  })

  test("#given content with no frontmatter and an opencode example #when processed #then the banner is prepended", () => {
    const content = "# Test Skill\n\ncall_omo_agent(subagent_type=\"explore\")\n"
    const result = insertSenpiCompatibilityGuidance(content)
    assert.ok(result.startsWith("## Senpi Harness Tool Compatibility"), "banner must be at the start")
    assert.ok(result.includes("# Test Skill"), "original content must follow the banner")
  })

  test("#given the banner string #when inspected #then it ends with the known end marker", () => {
    assert.ok(
      senpiHarnessToolCompatibility.endsWith(
        "If a code block below conflicts with this section, this section wins.\n\n",
      ),
      "banner must end with the canonical end marker",
    )
  })

  test("#given content with a stale banner after the first example #when processed #then the stale banner is removed and a fresh one inserted before the example", () => {
    const content = "---\nname: test\n---\n\n# Test Skill\n\ncall_omo_agent(subagent_type=\"explore\")\n\n## Senpi Harness Tool Compatibility\n\nStale text.\n"
    const result = insertSenpiCompatibilityGuidance(content)
    const bannerCount = (result.match(/## Senpi Harness Tool Compatibility/g) || []).length
    assert.equal(bannerCount, 1, "exactly one banner must exist after reprocessing")
    const bannerIndex = result.indexOf("## Senpi Harness Tool Compatibility")
    const exampleIndex = result.indexOf('call_omo_agent(subagent_type="explore")')
    assert.ok(bannerIndex < exampleIndex, "fresh banner must precede the first example")
  })
})
