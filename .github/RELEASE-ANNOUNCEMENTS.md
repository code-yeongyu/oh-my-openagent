# Discord release announcements

`release-announce.yml` announces published stable omo tags (`vX.Y.Z`) to
`#omo-releases`. Drafts, prereleases, and other tags are skipped. The release
body supplies the hook and up to four bold headline paragraphs. Whole paragraphs
are dropped to keep the message below 2000 characters. Blank lines inside code
fences do not split a paragraph, so truncation cannot leave a partial fenced
block. Mentions are disabled.

The repository secret `DISCORD_OMO_RELEASES_WEBHOOK_URL` must exist, including for
dry runs. It is passed only through the step environment and masked. Missing
credentials, empty release notes, malformed responses, and failed HTTP requests
fail the job with a tag-specific error.

The publish workflow creates the omo GitHub release with `GITHUB_TOKEN` and then
calls `release-announce.yml` as a reusable workflow with the required string
input `tag`. The caller waits for the `release` job and runs only when its
`created` output is `true`: this run successfully created the release, rather
than finding it already published. It skips LazyCodex-only and preparation
runs and passes only the Discord webhook secret. A failed
announcement makes the publish run itself red; no PAT is needed for this path.
The reusable job has read-only contents permission.

The caller also requires the validated release-metadata `dist_tag` to be empty,
which identifies a stable version; beta/other prerelease channels are excluded.
A non-stable tag passed directly through `workflow_call` exits successfully with
a skip notice. Manual `workflow_dispatch` still rejects a non-stable tag.
Reusable calls have an `automatic` input defaulting to true to distinguish them
from their inherited caller event.

The `release: published` trigger also handles releases created by a person.
That path explicitly skips releases authored by `github-actions[bot]` to avoid
double posts. Events created with `GITHUB_TOKEN` do not start downstream workflows
in any case. The announcement workflow reads the release by tag and runs the
maintained script from `dev`. Reusable calls are production mode; dry-run and
probe are only available through manual dispatch.

## Proof commands

Print the composed message and character count without posting:

```sh
gh workflow run release-announce.yml -f tag=v5.1.29 -f dry_run=true
```

Exercise delivery without re-announcing a real version:

```sh
gh workflow run release-announce.yml -f tag=v5.1.29 -f dry_run=false -f probe=true
```

The probe posts a clearly marked pipeline check with `wait=true`, immediately
deletes that returned message ID, and requires a subsequent GET to return 404.
A failed POST, DELETE, or deletion verification makes the run red. If DELETE
fails, the test message may remain; inspect the failed run before retrying.
`dry_run=true` takes precedence over `probe=true` and never posts.

The next real release is the production proof. Do not dispatch a production
announcement for an already-announced version to prove this workflow.

## Duplicate posts

The publisher invokes announcements directly; only person-authored `published`
events also trigger announcements, not `edited` or bot-authored release events.
Rerunning the publisher finds an existing release, outputs `created=false`, and
skips its announcement job. It never implicitly retries a failed post.
A webhook cannot list channel history, so there is no channel-history
deduplication guard. Rerunning a published-event job or dispatching with both
`dry_run=false` and `probe=false`, or rerunning the publisher's announcement job,
posts again. Use dry-run or probe for checks.

## Recover a missing announcement

Recovery is explicit: after confirming the post is missing, dispatch that one
tag with `dry_run=false` (leave `probe` at its default `false`):

```sh
gh workflow run release-announce.yml -f tag=v5.1.29 -f dry_run=false
```

The separate 30-minute release-with-no-post watch alerts when a published
version has no announcement. This workflow does not replace that watch or
automatically re-announce old versions.
