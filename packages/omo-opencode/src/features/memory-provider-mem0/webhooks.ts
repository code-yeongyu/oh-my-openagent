export type WebhookEvent =
  | "memory_created"
  | "memory_updated"
  | "memory_deleted"
  | "memory_consolidated"

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  "memory_created",
  "memory_updated",
  "memory_deleted",
  "memory_consolidated",
] as const

export interface WebhookConfig {
  webhook_id?: string
  url: string
  events: WebhookEvent[]
  project_id?: string
  secret?: string
  name?: string
}

export interface WebhookPayload {
  event: WebhookEvent
  memory_id: string
  project_id?: string
  timestamp: string
  data?: Record<string, unknown>
}

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WebhookValidationError"
  }
}

export interface WebhookClient {
  createWebhook(config: WebhookConfig): Promise<WebhookConfig>
  getWebhooks(project_id?: string): Promise<WebhookConfig[]>
  updateWebhook(webhook_id: string, config: Partial<WebhookConfig>): Promise<void>
  deleteWebhook(webhook_id: string): Promise<void>
}

export function validateWebhookConfig(config: WebhookConfig): void {
  if (!config.url) {
    throw new WebhookValidationError("Webhook url is required")
  }
  let parsed: URL
  try {
    parsed = new URL(config.url)
  } catch {
    throw new WebhookValidationError(`Webhook url is not a valid URL: ${config.url}`)
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new WebhookValidationError(
      `Webhook url protocol must be http or https (got ${parsed.protocol})`,
    )
  }
  if (!config.events || config.events.length === 0) {
    throw new WebhookValidationError("Webhook must subscribe to at least one event")
  }
  const unknown = config.events.filter((e) => !WEBHOOK_EVENTS.includes(e))
  if (unknown.length > 0) {
    throw new WebhookValidationError(`Unknown webhook events: ${unknown.join(", ")}`)
  }
}

export function matchesEvent(config: WebhookConfig, event: WebhookEvent): boolean {
  return config.events.includes(event)
}

export function filterWebhooksForEvent(
  webhooks: WebhookConfig[],
  event: WebhookEvent,
): WebhookConfig[] {
  return webhooks.filter((w) => matchesEvent(w, event))
}

export async function registerWebhook(
  client: WebhookClient,
  config: WebhookConfig,
): Promise<WebhookConfig> {
  validateWebhookConfig(config)
  return client.createWebhook(config)
}
