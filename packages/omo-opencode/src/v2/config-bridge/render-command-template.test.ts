import { describe, expect, it } from "bun:test"
import { renderCommandTemplate } from "./render-command-template"

describe("renderCommandTemplate", () => {
  describe("#given $ARGUMENTS", () => {
    it("#when the template uses it #then every occurrence becomes the raw argument text", () => {
      // given / when
      const text = renderCommandTemplate("Review: $ARGUMENTS\n(again) $ARGUMENTS", "the login flow")

      // then
      expect(text).toBe("Review: the login flow\n(again) the login flow")
    })

    it("#when there are no arguments #then the placeholder becomes empty", () => {
      // given / when / then
      expect(renderCommandTemplate("Run $ARGUMENTS now", "")).toBe("Run  now")
    })
  })

  describe("#given positional placeholders", () => {
    it("#when arguments are quoted #then each quoted phrase is one argument", () => {
      // given / when
      const text = renderCommandTemplate("a=$1 b=$2", 'one "two words"')

      // then
      expect(text).toBe("a=one b=two words")
    })

    it("#when more arguments are given than placeholders #then the last placeholder takes the rest", () => {
      // given / when
      const text = renderCommandTemplate("$1 then $2", "x y z")

      // then
      expect(text).toBe("x then y z")
    })

    it("#when a placeholder has no argument #then it becomes empty", () => {
      // given / when / then
      expect(renderCommandTemplate("[$1][$2]", "only")).toBe("[only][]")
    })
  })

  describe("#given a template with no placeholder", () => {
    it("#when arguments are given #then they are appended after a blank line", () => {
      // given / when
      const text = renderCommandTemplate("Do the thing.", "extra context")

      // then
      expect(text).toBe("Do the thing.\n\nextra context")
    })

    it("#when no arguments are given #then the template is unchanged", () => {
      // given / when / then
      expect(renderCommandTemplate("Do the thing.", "   ")).toBe("Do the thing.")
    })
  })
})
