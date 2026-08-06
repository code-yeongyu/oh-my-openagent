export { buildDefaultSisyphusJuniorPrompt } from "./default"
export { buildKimiK26SisyphusJuniorPrompt } from "./kimi-k2-6"
export { buildKimiK27SisyphusJuniorPrompt } from "./kimi-k2-7"
export { buildKimiK3SisyphusJuniorPrompt } from "./kimi-k3"
export { buildGptSisyphusJuniorPrompt } from "./gpt"
export { buildGpt54SisyphusJuniorPrompt } from "./gpt-5-4"
export { buildGpt55SisyphusJuniorPrompt } from "./gpt-5-5"
export { buildGeminiSisyphusJuniorPrompt } from "./gemini"
export { buildGlm52SisyphusJuniorPrompt } from "./glm-5-2"

export {
  SISYPHUS_JUNIOR_DEFAULTS,
  getSisyphusJuniorPromptSource,
  buildSisyphusJuniorPrompt,
  createSisyphusJuniorAgentWithOverrides,
} from "./agent"
export type { SisyphusJuniorPromptSource } from "./agent"
