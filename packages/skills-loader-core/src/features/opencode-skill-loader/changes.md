## 2026-10-22 - Retain global OpenCode source authority (#10693)

The disk reader distinguishes paths declared by global OpenCode configuration.
Discovery gives those explicitly selected sources user provenance, including when
the host supplies merged runtime paths. Project-only sources retain their policy.

## 2026-10-22 - Preserve skill I/O errors (#10693)

Unreadable or missing skill files and configured source folders load nothing and
report their path and original I/O error. Only a resolved path outside the allowed
boundary raises SkillLinkBlockedError. Descriptor replacement still fails closed.
