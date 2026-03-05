export { buildDefaultSisyphusJuniorPrompt } from "./default"
export { buildGptSisyphusJuniorPrompt } from "./gpt"
export { buildGeminiSisyphusJuniorPrompt } from "./gemini"

export {
  SISYPHUS_JUNIOR_DEFAULTS,
  getSisyphusJuniorPromptSource,
  buildSisyphusJuniorPrompt,
  createSisyphusJuniorAgentWithOverrides,
} from "./agent"
export type { SisyphusJuniorPromptSource } from "./agent"
