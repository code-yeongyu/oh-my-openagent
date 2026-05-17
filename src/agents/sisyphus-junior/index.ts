export { buildDefaultSisyphusJuniorPrompt } from "./default"
export { buildKimiK26SisyphusJuniorPrompt } from "./kimi-k2-6"
export { buildGptSisyphusJuniorPrompt } from "./gpt"
export { buildGpt54SisyphusJuniorPrompt } from "./gpt-5-4"
export { buildGpt55SisyphusJuniorPrompt } from "./gpt-5-5"
export { buildGpt53CodexSisyphusJuniorPrompt } from "./gpt-5-3-codex"
export { buildGeminiSisyphusJuniorPrompt } from "./gemini"

export {
  SISYPHUS_JUNIOR_DEFAULTS,
  getSisyphusJuniorPromptSource,
  buildSisyphusJuniorPrompt,
  createSisyphusJuniorAgentWithOverrides,
} from "./agent"
export type { SisyphusJuniorPromptSource } from "./agent"
