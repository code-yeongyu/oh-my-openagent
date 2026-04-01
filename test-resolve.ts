import { resolveModelWithFallback } from "./src/shared/model-resolver"

const input = {
  uiSelectedModel: "opencode/big-pickle",
  userModel: "anthropic/claude-opus-4-6",
  fallbackChain: [
    { providers: ["anthropic", "github-copilot"], model: "claude-opus-4-6" },
  ],
  availableModels: new Set(["anthropic/claude-opus-4-6", "github-copilot/claude-opus-4-6-preview"]),
  systemDefaultModel: "google/gemini-3.1-pro",
}

console.log(resolveModelWithFallback(input))
