# One TSV row per macOS/Windows job of a workflow run's jobs response: name, result, url, labels.
# A job that succeeded without running a test step proved nothing. Action steps (`uses:`, listed as "Run <action>@<ref>")
# and bookkeeping steps never run tests. Such a job's result is "no-tests", never "success", with one exception: ci.yml's
# macOS required contexts are Linux status jobs that report their own parts of "macos-combined-1" and "macos-combined-2",
# the two parallel jobs that run the macOS tests (ci-macos-status.sh), so a passing one with no test step of its own is
# proof only when both macOS jobs actually ran (each ended success or failure); when either was skipped, cancelled or
# absent the status job is "no-tests".
# A run made before the split has one job, "macos-combined", and neither part; it is judged by the same rule with that
# single job, so platform-red-first-red.sh still finds green pre-split runs in its 30-run lookback. Remove the legacy
# branch once 30 ci.yml runs on dev have completed after the split merged.
.jobs as $jobs
| (["macos-combined-1", "macos-combined-2"]) as $splitNames
| (if ($jobs | any(.name as $name | $splitNames | index($name)))
   or ($jobs | any(.name == "macos-combined") | not)
   then $splitNames else ["macos-combined"] end) as $macosNames
| ([$macosNames[] as $name | [$jobs[] | select(.name == $name)] | first]) as $macos
| ($macos | all(. != null and (.conclusion == "success" or .conclusion == "failure"))) as $macosRan
| $jobs[]
| select(((.labels | join(" ")) + " " + .name) | test("macos|windows"; "i"))
| ([.steps[]?
    | select(.conclusion == "success")
    | select(.name | test("^(Set up job|Complete job|Post |Run [^ ]+@|Write job summary|Check that this leg ran its tests)") | not)
  ] | length) as $ran
| (if .conclusion != "success" or $ran > 0 then (.conclusion // "none")
   elif (.name as $name | $macosNames | index($name) | not) and (.name | test("macos"; "i"))
   then (if $macosRan then "success" else "no-tests" end)
   else "no-tests" end) as $result
| [.name, $result, .html_url, (.labels | join(", "))]
| @tsv
