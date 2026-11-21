# One TSV row per macOS/Windows job of a workflow run's jobs response: name, result, url, labels.
# A job that succeeded without running a test step proved nothing. Action steps (`uses:`, listed as "Run <action>@<ref>")
# and bookkeeping steps never run tests. Such a job's result is "no-tests", never "success", with one exception: ci.yml's
# macOS required contexts are Linux status jobs that report their own part of "macos-combined", the one job that runs
# the macOS tests (ci-macos-status.sh), so a passing one with no test step of its own is proof only when macos-combined
# actually ran; when it was skipped, cancelled or absent the status job is "no-tests".
.jobs as $jobs
| ([$jobs[] | select(.name == "macos-combined")] | first) as $macos
| $jobs[]
| select(((.labels | join(" ")) + " " + .name) | test("macos|windows"; "i"))
| ([.steps[]?
    | select(.conclusion == "success")
    | select(.name | test("^(Set up job|Complete job|Post |Run [^ ]+@|Write job summary|Check that this leg ran its tests)") | not)
  ] | length) as $ran
| (if .conclusion != "success" or $ran > 0 then (.conclusion // "none")
   elif $macos != null and .name != "macos-combined" and (.name | test("macos"; "i"))
   then ($macos.conclusion | if . == "success" or . == "failure" then "success" else "no-tests" end)
   else "no-tests" end) as $result
| [.name, $result, .html_url, (.labels | join(", "))]
| @tsv
