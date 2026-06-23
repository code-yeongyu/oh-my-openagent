const HEADER_NAME = "x-request-id"
const MAX_LEN = 128

export function extractOrGenerateRequestId(request: Request): string {
  const incoming = request.headers.get(HEADER_NAME)?.trim()
  if (incoming && incoming.length > 0 && incoming.length <= MAX_LEN) return incoming
  return `idm-${crypto.randomUUID()}`
}
