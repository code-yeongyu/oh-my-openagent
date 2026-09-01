/// <reference path="../../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { createAgentBrowserTemplate } from "./agent-browser-template"

const EM_DASH = "\u2014"

describe("createAgentBrowserTemplate", () => {
  test("#given CRLF frontmatter #when creating the template #then it strips metadata and normalizes dashes", () => {
    // given
    const content = `---\r\nname: agent-browser\r\n---\r\nBody ${EM_DASH} text\r\n`

    // when
    const template = createAgentBrowserTemplate(content)

    // then
    expect(template).toBe("Body - text")
  })
})
