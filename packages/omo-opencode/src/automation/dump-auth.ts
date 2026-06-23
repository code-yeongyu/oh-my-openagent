// PORT-TODO(dump-auth): full dump-auth module deferred. Stub provides type-safe no-op for browser-session.
// Returns null so browser-session auth-dump branch becomes inactive.

export async function dumpAuthForSession(_pool: unknown, _sessionId: string, _origin: string): Promise<string> {
  return ""
}
