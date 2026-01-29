export interface StepUpInfo {
  requiredScopes: string[]
  error?: string
  errorDescription?: string
}

export function parseWwwAuthenticate(header: string): StepUpInfo | null {
  const trimmed = header.trim()
  const lowerHeader = trimmed.toLowerCase()
  const bearerIndex = lowerHeader.indexOf("bearer")
  if (bearerIndex === -1) {
    return null
  }

  const params = trimmed.slice(bearerIndex + "bearer".length).trim()
  if (params.length === 0) {
    return null
  }

  const scope = extractParam(params, "scope")
  if (scope === null) {
    return null
  }

  const requiredScopes = scope
    .split(/\s+/)
    .filter((s) => s.length > 0)

  if (requiredScopes.length === 0) {
    return null
  }

  const info: StepUpInfo = { requiredScopes }

  const error = extractParam(params, "error")
  if (error !== null) {
    info.error = error
  }

  const errorDescription = extractParam(params, "error_description")
  if (errorDescription !== null) {
    info.errorDescription = errorDescription
  }

  return info
}

function extractParam(params: string, name: string): string | null {
  const quotedPattern = new RegExp(`${name}="([^"]*)"`)
  const quotedMatch = quotedPattern.exec(params)
  if (quotedMatch) {
    return quotedMatch[1]
  }

  const unquotedPattern = new RegExp(`${name}=([^\\s,]+)`)
  const unquotedMatch = unquotedPattern.exec(params)
  return unquotedMatch?.[1] ?? null
}

export function mergeScopes(existing: string[], required: string[]): string[] {
  const set = new Set(existing)
  for (const scope of required) {
    set.add(scope)
  }
  return [...set]
}

export function isStepUpRequired(statusCode: number, headers: Record<string, string>): StepUpInfo | null {
  if (statusCode !== 403) {
    return null
  }

  const wwwAuth = headers["www-authenticate"] ?? headers["WWW-Authenticate"]
  if (!wwwAuth) {
    return null
  }

  return parseWwwAuthenticate(wwwAuth)
}
