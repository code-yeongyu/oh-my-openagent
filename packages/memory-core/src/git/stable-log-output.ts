// A user's git config can change what `git log` / `git show` print. `log.showSignature=true` puts gpg/ssh
// verification lines in stdout ahead of every signed commit, which corrupts each parsed `--format` read, and
// `log.follow=true` turns a single-pathspec log into `--follow`, which `--no-renames` rejects outright
// (#10726 review). Every memory read that parses `log`/`show -s` output carries these so the user's
// settings cannot change the answer.
export const STABLE_LOG_OUTPUT = ["-c", "log.showSignature=false", "-c", "log.follow=false"] as const
