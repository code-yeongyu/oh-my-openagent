export type ManusAuth = {
  jwt_token: string
  user_id?: string
  proxy_url?: string
  refresh_token?: string
}

const MANUS_ORIGIN = "https://manus.im"

export function parseManusAuthConfig(authConfigJson: string | null): ManusAuth {
  if (!authConfigJson) return { jwt_token: "" }
  try {
    const parsed = JSON.parse(authConfigJson) as Partial<ManusAuth>
    return {
      jwt_token: typeof parsed.jwt_token === "string" ? parsed.jwt_token : "",
      user_id: typeof parsed.user_id === "string" ? parsed.user_id : undefined,
      proxy_url: typeof parsed.proxy_url === "string" ? parsed.proxy_url : undefined,
      refresh_token: typeof parsed.refresh_token === "string" ? parsed.refresh_token : undefined,
    }
  } catch {
    return { jwt_token: "" }
  }
}

export function buildManusHeaders(
  auth: ManusAuth,
  custom: Record<string, string>,
): Record<string, string> {
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Origin": MANUS_ORIGIN,
    "Referer": `${MANUS_ORIGIN}/`,
    "Connect-Protocol-Version": "1",
  }
  if (auth.jwt_token) {
    base.Authorization = `Bearer ${auth.jwt_token}`
  }
  return { ...base, ...custom }
}
