// Pattern table mirrored from /Volumes/mengmotaStorage/local-workspaces/senpi/packages/ai/src/utils/overflow.ts.
const OVERFLOW_PATTERNS = [
  /prompt is too long/i, /request_too_large/i, /input is too long for requested model/i,
  /exceeds the context window/i, /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i, /maximum prompt length is \d+/i,
  /reduce the length of the messages/i, /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \d+ tokens/i,
  /exceeds the limit of \d+/i, /exceeds the available context size/i, /greater than the context length/i,
  /context window exceeds limit/i, /exceeded model token limit/i, /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /prompt too long; exceeded (?:max )?context length/i, /range of input length should be/i,
  /model_context_window_exceeded/i, /context[_ ]length[_ ]exceeded/i, /too many tokens/i, /token limit exceeded/i,
  /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i,
  /(?:request[ _])?(?:body|entity|payload)[_ ]too[_ ]large/i,
  /Request payload is \d+ (?:bytes, over the \d+ byte|tokens, over the \d+ token) limit Kiro accepts\./i,
  /Model context limit reached\. Conversation size exceeds model capacity\./i,
]
const NON_OVERFLOW_PATTERNS = [/^(Throttling error|Service unavailable):/i, /rate limit/i, /too many requests/i]

export function isContextOverflowMessage(message: string): boolean {
  return !NON_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message))
    && OVERFLOW_PATTERNS.some((pattern) => pattern.test(message))
}
