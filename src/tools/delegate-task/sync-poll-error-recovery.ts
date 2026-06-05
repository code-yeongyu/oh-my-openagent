export function shouldAttemptPollErrorRecovery(pollError: string): boolean {
  const trimmed = pollError.trim()

  if (trimmed.length === 0) {
    return false
  }

  if (/\bMessageAbortedError\b/u.test(trimmed)) {
    return true
  }

  if (/\bDOMException\b/u.test(trimmed) && /\bAbortError\b/u.test(trimmed)) {
    return true
  }

  if (/\bAbortError\b/u.test(trimmed) && !/\bTask aborted\b/u.test(trimmed)) {
    return true
  }

  if (/^the operation was aborted\.?$/iu.test(trimmed)) {
    return true
  }

  return false
}
