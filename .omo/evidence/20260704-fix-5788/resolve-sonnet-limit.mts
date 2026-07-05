import { resolveActualContextLimit } from "../../../packages/model-core/src/context-limit-resolver"

delete process.env.ANTHROPIC_1M_CONTEXT
delete process.env.VERTEX_ANTHROPIC_1M_CONTEXT

const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-5", {
  anthropicContext1MEnabled: false,
})

console.log(`anthropic/claude-sonnet-5 actualLimit=${actualLimit}`)
