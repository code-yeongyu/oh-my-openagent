export interface NpmDistTags {
  latest?: string
  beta?: string
  next?: string
  [tag: string]: string | undefined
}

const NPM_FETCH_TIMEOUT_MS = 5000

export async function fetchNpmDistTags(packageName: string): Promise<NpmDistTags | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`, {
      signal: AbortSignal.timeout(NPM_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as NpmDistTags
    return data
  } catch {
    return null
  }
}
