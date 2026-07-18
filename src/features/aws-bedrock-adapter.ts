import { env } from "process"

interface BedrockConfig {
  region: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  modelId: string
}

export function createBedrockConfig(): BedrockConfig | null {
  if (!env.AWS_BEDROCK_REGION) return null
  return {
    region: env.AWS_BEDROCK_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    modelId: env.AWS_BEDROCK_MODEL_ID ?? "anthropic.claude-3-sonnet-20240229-v1:0",
  }
}

export function isBedrockAvailable(): boolean {
  return !!env.AWS_BEDROCK_REGION && !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
}

export function getBedrockModelMapping(): Record<string, string> {
  return {
    "claude-3-sonnet": "anthropic.claude-3-sonnet-20240229-v1:0",
    "claude-3-haiku": "anthropic.claude-3-haiku-20240307-v1:0",
    "claude-3-opus": "anthropic.claude-3-opus-20240229-v1:0",
    "llama3-70b": "meta.llama3-70b-instruct-v1:0",
    "mistral-7b": "mistral.mistral-7b-instruct-v0:2",
  }
}
