# Mandated OpenCode QA for #6498 (doctor CLI change).
#
# Runs the REAL routed doctor CLI inside an ISOLATED XDG sandbox (XDG_DATA_HOME /
# XDG_CONFIG_HOME / XDG_CACHE_HOME / XDG_STATE_HOME all pointed at temp dirs, the
# convention in .agents/skills/opencode-qa/scripts/lib/common.sh) and proves the real
# opencode DB was not touched by comparing `SELECT count(*) FROM session` before and
# after, per AGENTS.md L18.
#
#   powershell -File .omo/evidence/20260731-fix-6484/live-doctor-opencode-qa.ps1 -Label after
#
# Exit 0 = the "Model cache not found" issue was produced and the DB is unchanged.

param([string]$Label = "after")

$ErrorActionPreference = "Continue"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
Set-Location $repoRoot

function Get-SessionCount {
  $raw = & opencode db "SELECT count(*) FROM session" --format json 2>$null | Out-String
  if ($raw -match '"count\(\*\)"\s*:\s*(\d+)') { return [int]$Matches[1] }
  return -1
}

$dbPath = (& opencode db path 2>$null | Select-Object -First 1)
$countBefore = Get-SessionCount

$sandbox = Join-Path $env:TEMP ("oqa-6498-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$data = Join-Path $sandbox "data"; $config = Join-Path $sandbox "config"
$cache = Join-Path $sandbox "cache"; $state = Join-Path $sandbox "state"
New-Item -ItemType Directory -Force -Path $data, $config, $cache, $state | Out-Null

try {
  $env:XDG_DATA_HOME = $data
  $env:XDG_CONFIG_HOME = $config
  $env:XDG_CACHE_HOME = $cache
  $env:XDG_STATE_HOME = $state

  Write-Output "=== LABEL: $Label ==="
  Write-Output "=== ISOLATION ==="
  Write-Output "  XDG_DATA_HOME/CONFIG_HOME/CACHE_HOME/STATE_HOME -> <SANDBOX>\{data,config,cache,state}"
  Write-Output "  real opencode DB: <HOME>\.local\share\opencode\opencode.db"
  Write-Output "  sessions before: $countBefore"

  Write-Output ""
  Write-Output "=== REAL ROUTED CLI: bun packages/omo-opencode/src/cli/index.ts doctor --json ==="
  $raw = & bun (Join-Path $repoRoot "packages\omo-opencode\src\cli\index.ts") doctor --json 2>&1 | Out-String
  $exit = $LASTEXITCODE

  $issue = $null
  try {
    $start = $raw.IndexOf('{')
    if ($start -ge 0) {
      $parsed = $raw.Substring($start) | ConvertFrom-Json
      foreach ($chk in $parsed.results) {
        foreach ($i in $chk.issues) {
          if ($i.title -eq "Model cache not found") { $issue = $i }
        }
      }
    }
  } catch { }

  if ($null -ne $issue) {
    Write-Output "  issue.title       : $($issue.title)"
    Write-Output "  issue.severity    : $($issue.severity)"
    Write-Output "  issue.description : $($issue.description -replace [regex]::Escape($sandbox), '<SANDBOX>')"
    Write-Output "  issue.fix         : $($issue.fix -replace [regex]::Escape($sandbox), '<SANDBOX>')"
  } else {
    Write-Output "  NO 'Model cache not found' issue found in doctor --json output"
    Write-Output ("  raw tail: " + ($raw -split "`n" | Select-Object -Last 5 | Out-String).Trim())
  }
  Write-Output "  doctor exit=$exit"

  # The count MUST be read outside the sandbox: with XDG_DATA_HOME still redirected,
  # `opencode db` would resolve the sandbox DB and report 0, not the real one.
  Remove-Item Env:\XDG_DATA_HOME, Env:\XDG_CONFIG_HOME, Env:\XDG_CACHE_HOME, Env:\XDG_STATE_HOME -ErrorAction SilentlyContinue
  $countAfter = Get-SessionCount

  Write-Output ""
  Write-Output "=== DB-UNTOUCHED PROOF (real DB, read outside the sandbox) ==="
  Write-Output "  sessions after : $countAfter"
  Write-Output "  count unchanged: $($countBefore -eq $countAfter)"

  $ok = ($null -ne $issue) -and ($countBefore -eq $countAfter) -and ($countBefore -ge 0)
  Write-Output ""
  Write-Output "RESULT: $(if ($ok) { 'PASS' } else { 'FAIL' })"
  if (-not $ok) { exit 1 }
  exit 0
}
finally {
  Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\XDG_DATA_HOME, Env:\XDG_CONFIG_HOME, Env:\XDG_CACHE_HOME, Env:\XDG_STATE_HOME -ErrorAction SilentlyContinue
}
