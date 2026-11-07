# Release proof: the five facts a release claim owes

"Released", "published", "deployed" and "safe to tag" are claims about an artifact that left the repository. Each one is settled by five facts, and a report that lacks one names the gap instead of the verb. The contract is adapted from the release rules of lidge-jun/codexclaw's `dev-devops` skill (MIT).

| Fact | What to record | Where it comes from |
|---|---|---|
| Artifact digest | the SHA-256 (or the registry digest) of the exact bytes that shipped, and the version string stamped inside them | `shasum -a 256 <file>`, `docker buildx imagetools inspect`, the registry's `dist.integrity` or `sha512` for an npm tarball |
| Builder identity | which workflow run, runner and commit produced the artifact | the CI run URL and its `GITHUB_SHA`, or for a local build the machine and the `git rev-parse HEAD` of the tree, plus the toolchain versions it used |
| Target | where the artifact went: registry and tag, environment and cluster, store channel, download URL | the publish command's output, read back from the target (`npm view <pkg>@<version> dist.shasum`, `kubectl get deploy -o jsonpath`, a GET on the URL) |
| Smoke evidence | one real exercise of the shipped artifact on its target, not of the source tree | an install from the registry into an empty directory and one command; a request against the deployed URL with its status line; the app launched from the signed bundle |
| Rollback evidence | the previous artifact is still reachable and the step that re-points to it was tried, or is written down with the command | the previous tag or digest, the `rollback`/`redeploy` command, and when a dry run exists, its output |

## Rules

- Pin the readiness report to the commit it describes. When the head moves after the report, prove the delta is docs-only (`git diff --name-only <frozen> <head>`) or redo the gates on the new head; every gate receipt stays on the SHA it ran against.
- A red gate is never excused inside the report that gate failed. Make the original command green, or declare the replacement gate before the verdict, never after the failure.
- Review threads still open on the merged PRs are a blocker to the GO decision, counted after merge: a thread opened minutes before the merge counts until it is resolved or dismissed with a reason.
- A gate without an owner is a wish. Every mandatory gate has a step that runs it and a recorded terminal outcome: pass, not reproduced, or deregistered on purpose.
- The smoke test exercises the artifact the users receive. A green test suite on the source tree is evidence for the build, not for the release.

## Shape of the report

```
release <name> <version>
  digest    sha256:...   (file or registry digest)
  builder   <ci run url> at <commit>; <toolchain versions>
  target    <registry/tag | environment | channel>, read back: <command and its decisive line>
  smoke     <command against the target> -> <status or output line>
  rollback  previous <tag/digest> reachable; <command>; <dry-run line or "not tried: <reason>">
```

A missing row is written as `missing` with the reason, and the sentence that follows says the release is not proven, which is a different sentence from "the release failed".
