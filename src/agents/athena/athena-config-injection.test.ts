import { describe, expect, it } from "bun:test"
import { createAthenaAgent } from "./agent"

describe("Athena prompt config injection placeholders", () => {
  const athenaConfig = createAthenaAgent("anthropic/claude-opus-4-6")

  describe("#given the Athena agent prompt", () => {
    describe("#when checking for runtime injection placeholders", () => {
      it("#then contains RETRY_ON_FAIL placeholder", () => {
        expect(athenaConfig.prompt).toContain("{RETRY_ON_FAIL}")
      })

      it("#then contains STUCK_THRESHOLD_SECONDS placeholder", () => {
        expect(athenaConfig.prompt).toContain("{STUCK_THRESHOLD_SECONDS}")
      })

      it("#then contains quorum reference", () => {
        expect(athenaConfig.prompt).toContain("quorum")
      })

      it("#then contains timeout reference with 30000", () => {
        expect(athenaConfig.prompt).toContain("30000")
      })

      it("#then contains RETRY_FAILED_IF_OTHERS_FINISHED placeholder", () => {
        expect(athenaConfig.prompt).toContain("{RETRY_FAILED_IF_OTHERS_FINISHED}")
      })

      it("#then contains CANCEL_RETRYING_ON_QUORUM placeholder", () => {
        expect(athenaConfig.prompt).toContain("{CANCEL_RETRYING_ON_QUORUM}")
      })
    })
  })
})
