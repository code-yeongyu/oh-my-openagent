// The goldens' normalisation (scenario-run.ts): each fixed replacement in turn, then ANSI colour codes removed, so two
// runs that differ only in a sandbox path or colour compare equal. The coverage rule's answer check uses it too.
export const normalizer =
  (pairs: readonly (readonly [string, string])[]) =>
  (text: string): string =>
    pairs.reduce((acc, [from, to]) => acc.split(from).join(to), text).replace(/\u001b\[[0-9;]*m/g, "")
