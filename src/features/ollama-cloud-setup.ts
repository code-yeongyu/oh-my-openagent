const OLLAMA_CLOUD_DEFAULT_URL = "https://cloud.ollama.ai"

export interface OllamaCloudConfig {
  enabled: boolean
  baseUrl: string
  apiKey?: string
  defaultModel: string
}

export function getOllamaCloudInstallerSteps(): Array<{ title: string; code: string }> {
  return [
    {
      title: "Install Ollama CLI",
      code: "curl -fsSL https://ollama.com/install.sh | sh",
    },
    {
      title: "Sign up for Ollama Cloud",
      code: `echo "Visit https://cloud.ollama.ai to sign up and get your API key"`,
    },
    {
      title: "Configure OMO for Ollama",
      code: `omo config set providers.ollama.baseUrl ${OLLAMA_CLOUD_DEFAULT_URL}`,
    },
  ]
}

export function createOllamaCloudProvider() {
  return {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    models: ["llama3.1", "llama3", "mistral", "codellama", "deepseek-coder", "phi3", "qwen2"],
    defaultModel: "llama3.1",
    getConfig: (apiKey?: string): OllamaCloudConfig => ({
      enabled: true,
      baseUrl: OLLAMA_CLOUD_DEFAULT_URL,
      apiKey,
      defaultModel: "llama3.1",
    }),
  }
}
