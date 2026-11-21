# One TSV row per macOS/Windows job of a workflow run's jobs response: name, result, url, labels.
# A job that succeeded with only bookkeeping steps run (a dev push that skipped the heavy legs) proved nothing, so its
# result is "no-tests", never "success". Read by platform-red-first-red.sh and base-platform-green.sh.
.jobs[]
| select(((.labels | join(" ")) + " " + .name) | test("macos|windows"; "i"))
| ([.steps[]?
    | select(.conclusion == "success")
    | select(.name | test("^(Set up job|Complete job|Post |Run actions/checkout|Write job summary|Check that this leg ran its tests)") | not)
  ] | length) as $ran
| [.name, (if .conclusion == "success" and $ran == 0 then "no-tests" else (.conclusion // "none") end),
   .html_url, (.labels | join(", "))]
| @tsv
