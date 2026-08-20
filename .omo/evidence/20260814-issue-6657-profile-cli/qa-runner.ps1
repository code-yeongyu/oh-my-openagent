$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "../../../")).Path
$hostHome = [Environment]::GetFolderPath("UserProfile")
$hostConfig = Join-Path $hostHome ".omo/omo.jsonc"

function Get-HostConfigMetadata {
  if (-not (Test-Path -LiteralPath $hostConfig -PathType Leaf)) {
    return [ordered]@{ exists = $false; sha256 = $null; length = $null; last_write_utc = $null }
  }
  $item = Get-Item -LiteralPath $hostConfig
  return [ordered]@{
    exists = $true
    sha256 = (Get-FileHash -LiteralPath $hostConfig -Algorithm SHA256).Hash.ToLower()
    length = $item.Length
    last_write_utc = $item.LastWriteTimeUtc.ToString("o")
  }
}

$hostBefore = Get-HostConfigMetadata
$opencodeBefore = $null -ne (Get-Command opencode -ErrorAction SilentlyContinue)
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$staleRootsRemoved = 0
foreach ($staleRoot in Get-ChildItem -LiteralPath $tempBase -Directory -Filter "omo-qa-6657-*" -ErrorAction SilentlyContinue) {
  $stalePath = [IO.Path]::GetFullPath($staleRoot.FullName)
  if ($stalePath.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and $staleRoot.Name -like "omo-qa-6657-*") {
    Remove-Item -LiteralPath $stalePath -Recurse -Force
    $staleRootsRemoved++
  }
}
$root = Join-Path $tempBase ("omo-qa-6657-" + [Guid]::NewGuid().ToString("N"))
$rootFull = [IO.Path]::GetFullPath($root)
if (-not $rootFull.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($rootFull) -notlike "omo-qa-6657-*") {
  throw "Refusing unsafe QA temp root"
}

$qaHome = Join-Path $rootFull "home"
$project = Join-Path $rootFull "project"
$configDir = Join-Path $qaHome ".omo"
$configPath = Join-Path $configDir "omo.jsonc"
$xdgData = Join-Path $rootFull "xdg-data"
$xdgConfig = Join-Path $rootFull "xdg-config"
$xdgState = Join-Path $rootFull "xdg-state"
$xdgCache = Join-Path $rootFull "xdg-cache"
$npmCache = Join-Path $xdgCache "npm"
$bunCache = Join-Path $xdgCache "bun"

foreach ($dir in @($qaHome, $project, $configDir, $xdgData, $xdgConfig, $xdgState, $xdgCache, $npmCache, $bunCache)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$seedConfig = @"
{
  // QA comment must survive profile writes
  "profiles": {
    "kimi": { "categories": { "quick": { "model": "kimi-for-qa" } } },
    "gpt": { "categories": { "quick": { "model": "gpt-for-qa" } } }
  }
}
"@
[IO.File]::WriteAllText($configPath, $seedConfig, [Text.UTF8Encoding]::new($false))

$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$bundle = Join-Path $repo "dist/cli/index.js"

function Invoke-ProfileCli([string[]]$ProfileArgs, [hashtable]$Overrides = @{}) {
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $npx
  $psi.WorkingDirectory = $project
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $allArgs = @("--yes", "bun", $bundle, "profile") + $ProfileArgs
  $psi.Arguments = ($allArgs | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join " "
  foreach ($key in @("OMO_PROFILE", "OCX_PROFILE", "OPENCODE_CONFIG_DIR")) {
    [void]$psi.Environment.Remove($key)
  }
  $envMap = [ordered]@{
    HOME = $qaHome
    USERPROFILE = $qaHome
    XDG_DATA_HOME = $xdgData
    XDG_CONFIG_HOME = $xdgConfig
    XDG_STATE_HOME = $xdgState
    XDG_CACHE_HOME = $xdgCache
    npm_config_cache = $npmCache
    BUN_INSTALL_CACHE_DIR = $bunCache
    OPENCODE_DISABLE_AUTOUPDATE = "1"
    OPENCODE_DISABLE_MODELS_FETCH = "1"
  }
  foreach ($entry in $envMap.GetEnumerator()) {
    $psi.Environment[$entry.Key] = $entry.Value
  }
  foreach ($entry in $Overrides.GetEnumerator()) {
    $psi.Environment[$entry.Key] = [string]$entry.Value
  }

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $displayArgs = "profile " + ($ProfileArgs -join " ")
  return [ordered]@{
    command = "npx --yes bun dist/cli/index.js $displayArgs"
    override = if ($Overrides.ContainsKey("OMO_PROFILE")) { "OMO_PROFILE=$($Overrides['OMO_PROFILE'])" } else { "none" }
    exit_code = $process.ExitCode
    stdout = $stdout.Replace($rootFull, "%QA_ROOT%").Replace($repo, "%WORKSPACE%").TrimEnd()
    stderr = $stderr.Replace($rootFull, "%QA_ROOT%").Replace($repo, "%WORKSPACE%").TrimEnd()
    process_exited = $process.HasExited
  }
}

$beforeConfig = [IO.File]::ReadAllText($configPath)
$commands = [ordered]@{}
$commands.list_before = Invoke-ProfileCli @("list")
$commands.use_gpt = Invoke-ProfileCli @("use", "gpt")
$afterUseConfig = [IO.File]::ReadAllText($configPath)
$commands.list_after_use = Invoke-ProfileCli @("list")
$commands.current_persisted = Invoke-ProfileCli @("current")
$commands.current_override = Invoke-ProfileCli @("current") @{ OMO_PROFILE = "kimi" }
$commands.clear_with_override = Invoke-ProfileCli @("clear") @{ OMO_PROFILE = "kimi" }
$afterClearConfig = [IO.File]::ReadAllText($configPath)
$commands.current_after_clear_override = Invoke-ProfileCli @("current") @{ OMO_PROFILE = "kimi" }
$commands.current_after_clear_base = Invoke-ProfileCli @("current")
$commands.current_missing_override = Invoke-ProfileCli @("current") @{ OMO_PROFILE = "missing" }

$goodConfigBeforeNegativeCases = [IO.File]::ReadAllText($configPath)
$projectConfigDir = Join-Path $project ".omo"
$projectConfigPath = Join-Path $projectConfigDir "omo.jsonc"
New-Item -ItemType Directory -Path $projectConfigDir -Force | Out-Null
[IO.File]::WriteAllText($projectConfigPath, @"
{
  "profiles": {
    "local": { "categories": { "quick": { "model": "project-only-for-qa" } } }
  }
}
"@, [Text.UTF8Encoding]::new($false))
$commands.list_with_project_profile = Invoke-ProfileCli @("list")
$userHashBeforeProjectUse = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLower()
$commands.use_project_only = Invoke-ProfileCli @("use", "local")
$userHashAfterProjectUse = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLower()
$commands.use_blank = Invoke-ProfileCli @("use", "")
$userHashAfterBlankUse = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLower()
$commands.use_whitespace = Invoke-ProfileCli @("use", "   ")
$userHashAfterWhitespaceUse = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLower()

$whitespaceConfig = '{ "active_profile": "   ", "profiles": { "gpt": {} } }'
[IO.File]::WriteAllText($configPath, $whitespaceConfig, [Text.UTF8Encoding]::new($false))
$commands.current_whitespace_config = Invoke-ProfileCli @("current")
[IO.File]::WriteAllText($configPath, '{ "profiles": {', [Text.UTF8Encoding]::new($false))
$commands.current_malformed = Invoke-ProfileCli @("current")

$filesBeforeCleanup = @(Get-ChildItem -LiteralPath @($qaHome, $project) -File -Recurse | Sort-Object FullName | ForEach-Object {
  [ordered]@{
    relative_path = $_.FullName.Substring($rootFull.Length + 1).Replace("\", "/")
    length = $_.Length
    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()
  }
})

$happyCommandNames = @(
  "list_before", "use_gpt", "list_after_use", "current_persisted", "current_override",
  "clear_with_override", "current_after_clear_override", "current_after_clear_base",
  "current_missing_override", "list_with_project_profile"
)
$assertions = [ordered]@{
  happy_commands_exit_zero = (@($happyCommandNames | ForEach-Object { $commands[$_].exit_code }) -notcontains 1)
  negative_commands_exit_one = $commands.use_project_only.exit_code -eq 1 -and $commands.use_blank.exit_code -eq 1 -and $commands.use_whitespace.exit_code -eq 1 -and $commands.current_whitespace_config.exit_code -eq 1 -and $commands.current_malformed.exit_code -eq 1
  list_sorted = $commands.list_before.stdout -match "Profiles:\r?\n  gpt\r?\n  kimi"
  active_marker_after_use = $commands.list_after_use.stdout -match "Profiles:\r?\n\* gpt\r?\n  kimi"
  comment_preserved_after_use = $afterUseConfig.Contains("// QA comment must survive profile writes")
  active_profile_written = $afterUseConfig.Contains('"active_profile": "gpt"')
  persisted_current = $commands.current_persisted.stdout -match '^gpt \(persisted in your omo config\)$'
  override_wins = $commands.current_override.stdout -match '^kimi \(from OMO_PROFILE\)$'
  active_profile_removed_after_clear = -not $afterClearConfig.Contains('"active_profile"')
  override_survives_clear = $commands.current_after_clear_override.stdout -match '^kimi \(from OMO_PROFILE\)$'
  base_after_clear_without_override = $commands.current_after_clear_base.stdout -match '^No active profile'
  comment_preserved_after_clear = $afterClearConfig.Contains("// QA comment must survive profile writes")
  missing_selected_profile_reports_base = $commands.current_missing_override.stdout -match '^No active profile \(using the base config\)\.$'
  missing_selected_profile_diagnostic = $commands.current_missing_override.stderr -match 'does not exist; using the base configuration'
  project_only_profile_labeled = $commands.list_with_project_profile.stdout -match '  local \(project only\)'
  project_only_use_rejected = $commands.use_project_only.stderr -match 'defined only in project config and cannot be persisted globally'
  project_only_use_did_not_change_user_config = $userHashBeforeProjectUse -eq $userHashAfterProjectUse
  blank_use_rejected = $commands.use_blank.stderr -match 'Profile name must not be empty|missing required argument'
  blank_use_did_not_change_user_config = $userHashAfterProjectUse -eq $userHashAfterBlankUse
  whitespace_use_rejected = $commands.use_whitespace.stderr -match 'Profile name must not be empty'
  whitespace_use_did_not_change_user_config = $userHashAfterBlankUse -eq $userHashAfterWhitespaceUse
  whitespace_config_nonzero = $commands.current_whitespace_config.exit_code -eq 1
  whitespace_config_no_stdout = $commands.current_whitespace_config.stdout.Length -eq 0
  whitespace_config_reports_validation_error = $commands.current_whitespace_config.stderr -match 'non-whitespace|Invalid omo config'
  malformed_config_nonzero = $commands.current_malformed.exit_code -eq 1
  malformed_config_no_stdout = $commands.current_malformed.stdout.Length -eq 0
  malformed_config_reports_parse_error = $commands.current_malformed.stderr -match 'JSONC parse error'
}

$hostAfter = Get-HostConfigMetadata
$opencodeAfter = $null -ne (Get-Command opencode -ErrorAction SilentlyContinue)
$hostUnchanged = ($hostBefore | ConvertTo-Json -Compress) -eq ($hostAfter | ConvertTo-Json -Compress)

# The resolved path was validated above as a dedicated omo-qa-6657 child of the system temp directory.
Remove-Item -LiteralPath $rootFull -Recurse -Force
$cleanup = [ordered]@{
  temp_root_pattern = "%TEMP%/omo-qa-6657-*"
  stale_roots_removed_before_run = $staleRootsRemoved
  resolved_under_system_temp = $true
  removed = -not (Test-Path -LiteralPath $rootFull)
  spawned_processes_all_exited = (@($commands.Values | ForEach-Object { $_.process_exited }) -notcontains $false)
}

$result = [ordered]@{
  surface = "freshly built dist/cli/index.js via npx --yes bun"
  isolation = [ordered]@{
    HOME = "%QA_ROOT%/home"
    USERPROFILE = "%QA_ROOT%/home"
    XDG_DATA_HOME = "%QA_ROOT%/xdg-data"
    XDG_CONFIG_HOME = "%QA_ROOT%/xdg-config"
    XDG_STATE_HOME = "%QA_ROOT%/xdg-state"
    XDG_CACHE_HOME = "%QA_ROOT%/xdg-cache"
    project = "%QA_ROOT%/project"
  }
  commands = $commands
  configs = [ordered]@{
    before = $beforeConfig
    after_use = $afterUseConfig
    after_clear = $afterClearConfig
    before_negative_cases = $goodConfigBeforeNegativeCases
    whitespace_fixture = $whitespaceConfig
    malformed_fixture = '{ "profiles": {'
  }
  assertions = $assertions
  sandbox_files_before_cleanup = $filesBeforeCleanup
  host_config = [ordered]@{
    path_label = "~/.omo/omo.jsonc"
    contents_copied = $false
    before = $hostBefore
    after = $hostAfter
    unchanged = $hostUnchanged
  }
  opencode_db = [ordered]@{
    applicable = $false
    reason = "opencode executable absent; no DB path/query surface available"
    opencode_absent_before = -not $opencodeBefore
    opencode_absent_after = -not $opencodeAfter
  }
  cleanup = $cleanup
}

$resultJson = $result | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "real-cli.json"), $resultJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
$resultJson
