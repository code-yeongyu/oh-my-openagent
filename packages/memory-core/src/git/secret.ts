import { redactSecretLikeMaterial, scanSecretLikeMaterial, type SecretPatternClass } from "../sync/redact"

/**
 * Refusal raised by the commit gate when staged memory content or a staged path
 * is secret-like. The message names the masked path and the pattern class only;
 * the matched text never appears in the error.
 */
export class MemorySecretError extends Error {
  override readonly name = "MemorySecretError"
  readonly path: string
  readonly patternClass: SecretPatternClass
  readonly where: "content" | "path"

  constructor(options: { readonly path: string; readonly patternClass: SecretPatternClass; readonly where: "content" | "path" }) {
    super(
      options.where === "path"
        ? `refused: ${redactSecretLikeMaterial(options.path)} is a secret-like file name (${options.patternClass})`
        : `refused: ${options.path} contains secret-like content (${options.patternClass}); remove it and retry`,
    )
    this.path = options.path
    this.patternClass = options.patternClass
    this.where = options.where
  }
}

/** First pattern class a scanner hit carries, or undefined when the text is clean. */
export function secretPatternClassOf(text: string): SecretPatternClass | undefined {
  return scanSecretLikeMaterial(text)[0]?.class
}
