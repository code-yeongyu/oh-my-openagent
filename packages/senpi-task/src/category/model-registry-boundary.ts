import type { SenpiModelPort } from "./types"

const SECRET_LIKE_MODEL_FIELD_NAMES: ReadonlySet<string> = new Set([
  "accesstoken", "apikey", "auth", "authorization",
  "bearertoken", "clientsecret", "password", "privatekey",
  "privatetoken", "secret", "secretkey", "token",
])

export function ownStringDataProperty(model: object, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(model, key)
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined
}

export function isSafeSenpiModel<TModel extends SenpiModelPort>(model: unknown): model is TModel {
  if (typeof model !== "object" || model === null) return false
  const carriesSecret = Object.getOwnPropertyNames(model).some((key) =>
    SECRET_LIKE_MODEL_FIELD_NAMES.has(key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase())
  )
  return !carriesSecret
    && ownStringDataProperty(model, "provider") !== undefined
    && ownStringDataProperty(model, "id") !== undefined
}
