/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { parseTtsrRule } from "./rule-parser"

const makeContent = (frontmatter: string, body = "Do not do this.") =>
  `---\n${frontmatter}\n---\n${body}`

describe("RuleParser", () => {
  describe("#given condition as string", () => {
    describe("#when parsing", () => {
      describe("#then", () => {
        it("returns TtsrRule with condition array", () => {
          const content = makeContent('condition: "to=multi_tool_use"')
          const rule = parseTtsrRule("my-rule", content, "/rules/my-rule.md")
          expect(rule).not.toBeNull()
          expect(rule?.condition).toEqual(["to=multi_tool_use"])
          expect(rule?.name).toBe("my-rule")
          expect(rule?.path).toBe("/rules/my-rule.md")
        })
      })
    })
  })

  describe("#given condition as array", () => {
    describe("#when parsing", () => {
      describe("#then", () => {
        it("returns TtsrRule with all conditions", () => {
          const content = makeContent('condition:\n  - "pattern1"\n  - "pattern2"')
          const rule = parseTtsrRule("my-rule", content)
          expect(rule?.condition).toEqual(["pattern1", "pattern2"])
        })
      })
    })
  })

  describe("#given legacy ttsr_trigger field", () => {
    describe("#when parsing", () => {
      describe("#then", () => {
        it("maps ttsr_trigger to condition", () => {
          const content = makeContent('ttsr_trigger: "legacy_pattern"')
          const rule = parseTtsrRule("my-rule", content)
          expect(rule).not.toBeNull()
          expect(rule?.condition).toEqual(["legacy_pattern"])
        })
      })
    })
  })

  describe("#given legacy ttsrTrigger field", () => {
    describe("#when parsing", () => {
      describe("#then", () => {
        it("maps ttsrTrigger to condition", () => {
          const content = makeContent('ttsrTrigger: "camel_pattern"')
          const rule = parseTtsrRule("my-rule", content)
          expect(rule).not.toBeNull()
          expect(rule?.condition).toEqual(["camel_pattern"])
        })
      })
    })
  })

  describe("#given scope as comma-separated string", () => {
    describe("#when parsing", () => {
      describe("#then", () => {
        it("splits scope into array", () => {
          const content = makeContent('condition: "pat"\nscope: "text, tool:edit"')
          const rule = parseTtsrRule("my-rule", content)
          expect(rule?.scope).toEqual(["text", "tool:edit"])
        })
      })
    })
  })

  describe("#given globs field", () => {
    describe("#when parsing", () => {
      describe("#then", () => {
        it("preserves globs as array", () => {
          const content = makeContent('condition: "pat"\nglobs:\n  - "*.ts"')
          const rule = parseTtsrRule("my-rule", content)
          expect(rule?.globs).toEqual(["*.ts"])
        })
      })
    })
  })

  describe("#given no condition field", () => {
    describe("#when parsing", () => {
      describe("#then", () => {
        it("returns null", () => {
          const content = makeContent('description: "just a regular rule"')
          const rule = parseTtsrRule("my-rule", content)
          expect(rule).toBeNull()
        })
      })
    })
  })

  describe("#given invalid regex in condition", () => {
    describe("#when parsing", () => {
      describe("#then", () => {
        it("returns null without throwing", () => {
          const content = makeContent('condition: "[invalid"')
          expect(() => parseTtsrRule("my-rule", content)).not.toThrow()
          const rule = parseTtsrRule("my-rule", content)
          expect(rule).toBeNull()
        })
      })
    })
  })
})
