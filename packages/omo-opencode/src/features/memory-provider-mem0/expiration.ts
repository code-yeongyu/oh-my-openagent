export interface ExpirationConfig {
  expiration_date?: string
  ttl_seconds?: number
}

export class ExpirationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExpirationError"
  }
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?)?$/
const MAX_TTL_SECONDS = 60 * 60 * 24 * 365 * 10

export function validateExpiration(config: ExpirationConfig, now = new Date()): void {
  if (config.expiration_date === undefined && config.ttl_seconds === undefined) {
    return
  }
  if (config.expiration_date !== undefined && config.ttl_seconds !== undefined) {
    throw new ExpirationError(
      "Cannot specify both expiration_date and ttl_seconds (choose one)",
    )
  }
  if (config.expiration_date !== undefined) {
    if (!ISO_DATE_REGEX.test(config.expiration_date)) {
      throw new ExpirationError(
        `expiration_date must be ISO 8601 format (got ${config.expiration_date})`,
      )
    }
    const parsed = new Date(config.expiration_date)
    if (Number.isNaN(parsed.getTime())) {
      throw new ExpirationError(
        `expiration_date is not parseable: ${config.expiration_date}`,
      )
    }
    if (parsed.getTime() <= now.getTime()) {
      throw new ExpirationError(
        `expiration_date must be in the future (got ${config.expiration_date})`,
      )
    }
  }
  if (config.ttl_seconds !== undefined) {
    if (!Number.isFinite(config.ttl_seconds) || config.ttl_seconds <= 0) {
      throw new ExpirationError("ttl_seconds must be a positive finite number")
    }
    if (config.ttl_seconds > MAX_TTL_SECONDS) {
      throw new ExpirationError(
        `ttl_seconds exceeds max ${MAX_TTL_SECONDS} (~10 years)`,
      )
    }
  }
}

export function ttlToExpirationDate(ttl_seconds: number, now = new Date()): string {
  if (!Number.isFinite(ttl_seconds) || ttl_seconds <= 0) {
    throw new ExpirationError("ttl_seconds must be a positive finite number")
  }
  const expiry = new Date(now.getTime() + ttl_seconds * 1000)
  return expiry.toISOString()
}

export function buildExpirationMetadata(
  config: ExpirationConfig,
  now = new Date(),
): Record<string, string> {
  validateExpiration(config, now)
  if (config.expiration_date) {
    return { expiration_date: config.expiration_date }
  }
  if (config.ttl_seconds !== undefined) {
    return { expiration_date: ttlToExpirationDate(config.ttl_seconds, now) }
  }
  return {}
}

export function isExpired(
  expiration_date: string | undefined,
  now = new Date(),
): boolean {
  if (!expiration_date) return false
  const parsed = new Date(expiration_date)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.getTime() <= now.getTime()
}

export function filterActiveMemories<T extends { metadata?: Record<string, unknown> }>(
  memories: T[],
  now = new Date(),
): T[] {
  return memories.filter((m) => {
    const exp = m.metadata?.expiration_date
    return !isExpired(typeof exp === "string" ? exp : undefined, now)
  })
}

export const TTL_PRESETS = {
  one_hour: 60 * 60,
  one_day: 60 * 60 * 24,
  one_week: 60 * 60 * 24 * 7,
  thirty_days: 60 * 60 * 24 * 30,
  one_year: 60 * 60 * 24 * 365,
} as const
