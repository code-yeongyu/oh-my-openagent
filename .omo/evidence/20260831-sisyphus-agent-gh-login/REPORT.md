# sisyphus-agent gh login repair
WHAT: run 33353537198 (issue_comment on PR #7522) failed in the 'Authenticate gh CLI as sisyphus-dev-ai' step: modern gh refuses 'gh auth login' while GITHUB_TOKEN is set ("The value of the GITHUB_TOKEN environment variable is being used for authentication", exit 1) — agent never started.
FIX: pass the PAT as SISYPHUS_GH_PAT and clear GITHUB_TOKEN/GH_TOKEN for the login call only (env -u).
VALIDATION: actionlint clean on the edited workflow. Real-surface QA = post-merge re-trigger of @sisyphus-dev-ai on PR #7522 (recorded in the memleak session ledger).
