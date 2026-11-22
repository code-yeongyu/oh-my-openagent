# OmO native installer for Windows (Windows PowerShell 5.1 and PowerShell 7+):
#   irm https://get.omo.dev/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://get.omo.dev/install.ps1))) beta      # latest | beta | X.Y.Z
#   OMO_INSTALL_DIR           install directory (default $HOME\.local\bin)
#   OMO_NO_MODIFY_PATH=1      never edit the User PATH
#   OMO_INSTALL_BASE_URL      mirror base (default https://get.omo.dev); GitHub is the fallback
#   OMO_INSTALL_ALLOW_SUDO=1  allow running elevated (as Administrator)
# The whole body runs from Install-Omo on the last line, so a truncated download never runs half a script.
param([Parameter(Position = 0)][string]$OmoTarget = 'latest')

function Install-Omo {
  param([string]$Target)
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times slower with the progress bar on 5.1
  $GitHubDownload = 'https://github.com/code-yeongyu/oh-my-openagent/releases/download'
  $NpmDistTags = 'https://registry.npmjs.org/-/package/omo-ai/dist-tags'
  $UserAgent = 'omo-install.ps1/1'
  if ($env:OMO_INSTALL_QA -eq '1') { $UserAgent += ' omo-install-qa' } # QA runs stay out of the public count

  function Write-OmoSay([string]$Message) { Write-Host $Message }
  function Stop-OmoInstall([string]$Message) { throw "omo installer: $Message" }

  function Test-OmoVersion([string]$Value) {
    # \z, not $: .NET's $ also matches before a trailing newline
    return $Value -cmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?\z'
  }

  function ConvertFrom-OmoNpmVersion([string]$Value) {
    # npm publishes 5.2.0-0.beta.3 for the GitHub tag v5.2.0-beta.3
    return $Value -creplace '^([0-9]+\.[0-9]+\.[0-9]+)-0\.', '$1-'
  }

  function Get-OmoExpectedHash([string]$Sums, [string]$Asset) {
    foreach ($line in ($Sums -split "`r?`n")) {
      $fields = $line.Trim() -split '\s+', 2
      if ($fields.Count -ne 2) { continue }
      $name = $fields[1]
      if ($name.StartsWith('*')) { $name = $name.Substring(1) }
      if ($name -ceq $Asset -and $fields[0] -match '^[0-9A-Fa-f]{64}$') { return $fields[0].ToLowerInvariant() }
    }
    return ''
  }

  function Get-OmoSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }

  function Initialize-OmoNative {
    $type = 'OmoInstall.Native' -as [type]
    if ($null -eq $type) {
      Add-Type -Namespace OmoInstall -Name Native -MemberDefinition @'
[DllImport("kernel32.dll")]
public static extern bool IsProcessorFeaturePresent(uint feature);
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
'@
      $type = 'OmoInstall.Native' -as [type]
    }
    return $type
  }

  function Test-OmoAvx2 {
    try {
      $native = Initialize-OmoNative
      return [bool]$native::IsProcessorFeaturePresent(40) # PF_AVX2_INSTRUCTIONS_AVAILABLE
    } catch {
      Write-OmoSay "  could not detect AVX2 ($($_.Exception.Message)); using the baseline build"
      return $false
    }
  }

  function Get-OmoAsset {
    if (-not [Environment]::Is64BitOperatingSystem) { Stop-OmoInstall 'omo needs 64-bit Windows' }
    # The registry holds the native CPU, so x64 PowerShell emulated on ARM64 still gets the arm64 build.
    $envKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
    $arch = [string](Get-ItemProperty -LiteralPath $envKey -Name PROCESSOR_ARCHITECTURE -ErrorAction SilentlyContinue).PROCESSOR_ARCHITECTURE
    if (-not $arch) { $arch = [string]$env:PROCESSOR_ARCHITEW6432 }
    if (-not $arch) { $arch = [string]$env:PROCESSOR_ARCHITECTURE }
    switch ($arch.ToUpperInvariant()) {
      'ARM64' { return 'omo-windows-arm64.exe' }
      'AMD64' {
        if (Test-OmoAvx2) { return 'omo-windows-x64.exe' }
        return 'omo-windows-x64-baseline.exe'
      }
      default { Stop-OmoInstall "unsupported architecture '$arch'" }
    }
  }

  function Invoke-OmoFetch([string]$Url, [string]$OutFile, [switch]$Progress) {
    $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $curl) {
      # A connected transfer under 1 KB/s for 60 s is a stall, not a download (#12344): curl aborts
      # with exit 28, and --retry counts that abort as transient, so every stall is retried before failing.
      # Continue while curl runs: on 5.1, redirected native stderr under 'Stop' throws on the first line.
      $ErrorActionPreference = 'Continue'
      if ($Progress) {
        # -s would silence the bar; --progress-bar needs the error stream left on the console.
        & $curl.Path --proto '=https' --tlsv1.2 -f --show-error -L --retry 2 --connect-timeout 15 --speed-limit 1024 --speed-time 60 --progress-bar -A $UserAgent -o $OutFile $Url
        $log = ''
      } else {
        $log = & $curl.Path --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 15 --speed-limit 1024 --speed-time 60 -A $UserAgent -o $OutFile $Url 2>&1
      }
      $code = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
      if ($code -eq 0) { return }
      Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
      if ($code -eq 28) { throw "download of $Url stalled (under 1 KB/s for 60 s) or timed out after retries; check the connection and try again" }
      throw "curl.exe exited $code for ${Url}: $(($log | Out-String).Trim())"
    }
    # No curl.exe: stream over HttpWebRequest with an inactivity bound, not a total-duration cutoff,
    # so a healthy but slow transfer (the reported ~144 kbps case) finishes while a stall aborts (#12344).
    $stalled = $false
    $response = $null
    $out = $null
    try {
      try {
        $request = [Net.HttpWebRequest]::Create($Url)
        $request.UserAgent = $UserAgent
        $request.AllowAutoRedirect = $true
        $request.MaximumAutomaticRedirections = 10
        $request.Timeout = 15000 # connect and response headers only
        $response = $request.GetResponse()
        $stream = $response.GetResponseStream()
        $out = [IO.File]::Create($OutFile)
        $buffer = New-Object byte[] 65536
        $total = [long]$response.ContentLength # -1 when the server does not say
        $received = [long]0
        $lastNote = [long]0
        $idle = [Diagnostics.Stopwatch]::StartNew()
        $pending = $null
        while ($true) {
          if ($null -eq $pending) { $pending = $stream.ReadAsync($buffer, 0, $buffer.Length) }
          if (-not $pending.Wait(1000)) {
            if ($idle.ElapsedMilliseconds -ge 60000) { $stalled = $true; throw 'no data received for 60 s' }
            continue
          }
          $read = $pending.Result
          $pending = $null
          if ($read -le 0) { break }
          $out.Write($buffer, 0, $read)
          $received += $read
          $idle.Restart()
          if ($received - $lastNote -ge 1048576) {
            if ($total -gt 0) { Write-OmoSay ("  {0:N1} of {1:N1} MB received" -f ([double]$received / 1MB), ([double]$total / 1MB)) }
            else { Write-OmoSay ("  {0:N1} MB received" -f ([double]$received / 1MB)) }
            $lastNote = $received
          }
        }
      } finally {
        if ($null -ne $out) { $out.Dispose() }
        if ($null -ne $response) { $response.Close() }
      }
    } catch {
      Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
      if ($stalled) { throw "download of $Url stalled (no data received for 60 s); check the connection and try again" }
      throw "download of $Url failed: $($_.Exception.Message)"
    }
  }

  function Get-OmoFileSize([string]$Version, [string]$Name, [string]$Base) {
    # Best-effort Content-Length for the pre-download line (#12344); 0 when no mirror answers.
    $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    foreach ($url in @("$Base/v/$Version/$Name", "$GitHubDownload/v$Version/$Name")) {
      try {
        if ($null -ne $curl) {
          $ErrorActionPreference = 'Continue'
          # -L follows the mirror's redirects; curl then prints one header block per hop, and only
          # the last block's Content-Length is the final asset's (#12344).
          $head = & $curl.Path --proto '=https' --tlsv1.2 -fsSIL --connect-timeout 15 --max-time 20 -A $UserAgent $url 2>$null
          $code = $LASTEXITCODE
          $ErrorActionPreference = 'Stop'
          if ($code -eq 0) {
            $lengths = [regex]::Matches(($head | Out-String), '(?im)^\s*content-length:\s*(\d+)')
            if ($lengths.Count -gt 0) { return [long]$lengths[$lengths.Count - 1].Groups[1].Value }
          }
        } else {
          $response = Invoke-WebRequest -UseBasicParsing -Method Head -Uri $url -UserAgent $UserAgent -TimeoutSec 20 -MaximumRedirection 10
          $len = @($response.Headers['Content-Length'])[0]
          if ($len) { return [long]$len }
        }
      } catch { }
    }
    return [long]0
  }

  function Resolve-OmoVersion([string]$Want, [string]$Base, [string]$Work) {
    if (Test-OmoVersion $Want) { return $Want }
    $file = Join-Path $Work "channel-$Want"
    $got = ''
    try {
      Invoke-OmoFetch "$Base/channels/$Want" $file
      $got = ([string](Get-Content -LiteralPath $file -Raw)) -replace '\s', ''
    } catch {
      $got = ''
    }
    if (-not (Test-OmoVersion $got)) {
      Write-OmoSay "  $Base did not answer for channel $Want; asking the npm registry"
      $why = 'no version in the answer'
      try {
        Invoke-OmoFetch $NpmDistTags "$file.npm"
        $tags = Get-Content -LiteralPath "$file.npm" -Raw | ConvertFrom-Json
        $got = ConvertFrom-OmoNpmVersion ([string]$tags.$Want)
      } catch {
        $why = $_.Exception.Message
        $got = ''
      }
      if (-not (Test-OmoVersion $got)) {
        Stop-OmoInstall "could not resolve the $Want channel (mirror and npm registry both failed: $why)"
      }
    }
    return $got
  }

  function Save-OmoReleaseFile([string]$Version, [string]$Name, [string]$OutFile, [string]$Base, [switch]$Progress) {
    try {
      Invoke-OmoFetch "$Base/v/$Version/$Name" $OutFile -Progress:$Progress
      return
    } catch {
      Write-OmoSay "  mirror download of $Name failed; falling back to GitHub releases ($($_.Exception.Message))"
    }
    try {
      Invoke-OmoFetch "$GitHubDownload/v$Version/$Name" $OutFile -Progress:$Progress
    } catch {
      Stop-OmoInstall "could not download $Name $Version from the mirror or GitHub ($($_.Exception.Message))"
    }
  }

  function Install-OmoBinary([string]$Source, [string]$Target) {
    $staged = "$Target.new"
    Copy-Item -LiteralPath $Source -Destination $staged -Force
    $old = "$Target.old"
    if (Test-Path -LiteralPath $Target) {
      # A running omo.exe cannot be overwritten or deleted, but it can be renamed out of the way.
      if (Test-Path -LiteralPath $old) {
        try { Remove-Item -LiteralPath $old -Force -ErrorAction Stop } catch { $old = "$Target.old-$([guid]::NewGuid().ToString('N').Substring(0, 8))" }
      }
      Move-Item -LiteralPath $Target -Destination $old -Force
    }
    try {
      Move-Item -LiteralPath $staged -Destination $Target -Force
    } catch {
      if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $Target)) { Move-Item -LiteralPath $old -Destination $Target }
      throw
    }
  }

  function Test-OmoPathHas([string]$PathValue, [string]$Dir) {
    $want = $Dir.TrimEnd('\')
    foreach ($entry in ($PathValue -split ';')) {
      if ($entry -and [Environment]::ExpandEnvironmentVariables($entry).TrimEnd('\') -eq $want) { return $true }
    }
    return $false
  }

  function Send-OmoEnvironmentChange {
    try {
      $native = Initialize-OmoNative
      $result = [UIntPtr]::Zero
      # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, 5 s
      [void]$native::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
    } catch {
      Write-OmoSay "  could not announce the PATH change ($($_.Exception.Message)); sign out and back in if a new terminal cannot find omo"
    }
  }

  function Update-OmoPath([string]$Dir) { # returns $true when the User PATH was edited
    $onSession = Test-OmoPathHas $env:Path $Dir
    if (-not $onSession -and $env:GITHUB_PATH) { [IO.File]::AppendAllText($env:GITHUB_PATH, "$Dir`n") }
    if ($env:OMO_NO_MODIFY_PATH -eq '1') { return $false }
    $edited = $false
    # Raw registry access keeps %VAR% entries unexpanded and the value REG_EXPAND_SZ;
    # [Environment]::SetEnvironmentVariable would write them back expanded.
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    try {
      $userPath = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if (-not (Test-OmoPathHas $userPath $Dir)) {
        $rest = $userPath.Trim(';')
        $newPath = $Dir
        if ($rest) { $newPath = "$Dir;$rest" }
        $key.SetValue('Path', $newPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
        $edited = $true
      }
    } finally {
      $key.Close()
    }
    if ($edited) { Send-OmoEnvironmentChange }
    if (-not $onSession) { $env:Path = "$Dir;$env:Path" }
    return $edited
  }

  function Write-OmoReceipt([string]$Channel, [string]$Version, [string]$Asset, [string]$BinPath) {
    $dir = Join-Path $HOME '.omo'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $receipt = [ordered]@{
      method       = 'standalone'
      channel      = $Channel
      version      = $Version
      asset        = $Asset
      binPath      = $BinPath
      profileEdits = @()
      installedAt  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture)
    }
    $tmp = Join-Path $dir "install.json.$([guid]::NewGuid().ToString('N'))"
    [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $receipt) + "`n", (New-Object Text.UTF8Encoding $false))
    Move-Item -LiteralPath $tmp -Destination (Join-Path $dir 'install.json') -Force
  }

  function Get-OmoInstallOwner([string]$Path) {
    # npm/bun shims (omo.cmd, omo.ps1, bun's omo.exe + omo.bunx) name the package they launch.
    $text = $Path
    foreach ($file in @($Path, [IO.Path]::ChangeExtension($Path, '.bunx'))) {
      $item = Get-Item -LiteralPath $file -ErrorAction SilentlyContinue
      if ($null -ne $item -and $item.Length -lt 65536) {
        $bytes = [IO.File]::ReadAllBytes($item.FullName)
        $text += [Text.Encoding]::UTF8.GetString($bytes) + [Text.Encoding]::Unicode.GetString($bytes)
      }
    }
    if ($text -match 'node_modules[\\/]omo-ai([\\/]|$)') { return 'omo-ai (npm or bun global install)' }
    if ($text -match 'node_modules[\\/]oh-my-(opencode|openagent)([\\/]|$)') { return 'the legacy oh-my-openagent package' }
    return 'another omo binary'
  }

  function Show-OmoOtherInstalls([string]$Launcher) {
    $found = @(Get-Command omo -All -CommandType Application, ExternalScript -ErrorAction SilentlyContinue)
    if ($found.Count -eq 0) { return }
    $winner = [string]$found[0].Path
    $seen = @{ (Split-Path -Parent $Launcher) = $true }
    foreach ($command in $found) {
      $candidate = [string]$command.Path
      $dir = Split-Path -Parent $candidate
      if ($seen.ContainsKey($dir)) { continue }
      $seen[$dir] = $true
      $owner = Get-OmoInstallOwner $candidate
      Write-OmoSay ''
      Write-OmoSay "Note: $candidate is $owner."
      if ((Split-Path -Parent $winner) -eq $dir) {
        Write-OmoSay "  It comes first on PATH, so typing 'omo' still runs it instead of $Launcher."
      } elseif ($winner -eq $Launcher) {
        Write-OmoSay "  $Launcher comes first on PATH; that one is not used."
      } else {
        Write-OmoSay "  It is not the first omo on PATH; $winner is."
      }
      if ($owner.StartsWith('omo-ai')) {
        Write-OmoSay '  Nothing was removed. To keep only this install: bun remove -g omo-ai  (or: npm uninstall -g omo-ai)'
      } else {
        Write-OmoSay '  Nothing was removed. Remove it yourself if you no longer need it.'
      }
    }
  }

  function Test-OmoElevated {
    $principal = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  }

  $want = $Target
  if (-not $want) { $want = 'latest' }
  if ($want -cne 'latest' -and $want -cne 'beta' -and -not (Test-OmoVersion $want)) {
    Stop-OmoInstall "usage: install.ps1 [latest|beta|X.Y.Z] (got '$want')"
  }
  if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
    Stop-OmoInstall 'this installer is for Windows; elsewhere run: curl -fsSL https://get.omo.dev/install.sh | bash'
  }
  if ((Test-OmoElevated) -and $env:OMO_INSTALL_ALLOW_SUDO -ne '1') {
    Stop-OmoInstall 'refusing to run as Administrator; run it from a normal PowerShell (set OMO_INSTALL_ALLOW_SUDO=1 to override)'
  }
  if (-not $HOME) { Stop-OmoInstall 'HOME is not set' }
  if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }

  $base = [string]$env:OMO_INSTALL_BASE_URL
  if (-not $base) { $base = 'https://get.omo.dev' }
  $base = $base.TrimEnd('/')
  $dir = [string]$env:OMO_INSTALL_DIR
  if (-not $dir) { $dir = Join-Path $HOME '.local\bin' }
  $dir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($dir)
  $exe = Join-Path $dir 'omo.exe'
  $work = Join-Path ([IO.Path]::GetTempPath()) "omo-install.$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $asset = Get-OmoAsset
    $version = Resolve-OmoVersion $want $base $work
    $channel = $want
    if (Test-OmoVersion $want) { $channel = 'pinned' }
    Write-OmoSay "Installing omo $version ($asset) into $dir"

    $sums = Join-Path $work 'SHA256SUMS'
    Save-OmoReleaseFile $version 'SHA256SUMS' $sums $base
    $expected = Get-OmoExpectedHash ([string](Get-Content -LiteralPath $sums -Raw)) $asset
    if (-not $expected) { Stop-OmoInstall "SHA256SUMS for $version has no entry for $asset" }

    if ((Test-Path -LiteralPath $exe) -and (Get-OmoSha256 $exe) -eq $expected) {
      Write-OmoSay "  omo $version is already installed at $exe"
    } else {
      $size = Get-OmoFileSize $version $asset $base
      $sizeNote = ' (size unavailable)'
      if ($size -gt 0) { $sizeNote = " ($([math]::Round([double]$size / 1MB, 1)) MB)" }
      Write-OmoSay "  Downloading $asset$sizeNote"
      $download = Join-Path $work $asset
      Save-OmoReleaseFile $version $asset $download $base -Progress
      $actual = Get-OmoSha256 $download
      if ($actual -ne $expected) {
        Remove-Item -LiteralPath $download -Force
        Stop-OmoInstall "checksum mismatch for ${asset}: expected $expected, got $actual"
      }
      Write-OmoSay "  checksum verified (sha256 $expected)"
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      Install-OmoBinary $download $exe
    }

    Write-OmoSay '  Verifying the binary (--version); a first run can pause for an antivirus scan'
    $versionOut = Join-Path $work 'version.txt'
    try {
      $proc = Start-Process -FilePath $exe -ArgumentList '--version' -NoNewWindow -PassThru -RedirectStandardOutput $versionOut
    } catch {
      Stop-OmoInstall "$exe --version failed to start: $($_.Exception.Message)"
    }
    if (-not $proc.WaitForExit(60000)) {
      try { $proc.Kill() } catch { }
      Stop-OmoInstall "$exe --version did not answer within 60 s (likely an antivirus scan holding a first run); wait for the scan to finish and install again"
    }
    if ($proc.ExitCode -ne 0) { Stop-OmoInstall "$exe --version failed (exit code $($proc.ExitCode))" }
    $firstVersionLine = @((Get-Content -LiteralPath $versionOut -ErrorAction SilentlyContinue))[0]
    if ($firstVersionLine) { Write-OmoSay "  $firstVersionLine" }

    $pathEdited = Update-OmoPath $dir
    Write-OmoReceipt $channel $version $asset $exe
    Show-OmoOtherInstalls $exe
    Write-OmoSay ''
    Write-OmoSay "omo $version is installed at $exe."
    if ($pathEdited) {
      Write-OmoSay "Added $dir to your User PATH. This window can run omo now; other terminals see it after a restart."
    } elseif (-not (Test-OmoPathHas $env:Path $dir)) {
      Write-OmoSay "$dir is not on PATH (OMO_NO_MODIFY_PATH=1). Add it yourself, or run: & '$exe'"
    } else {
      Write-OmoSay 'Run: omo'
    }
    Write-OmoSay ''
    Write-OmoSay 'OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.'
    Write-OmoSay 'The data goes to PostHog in the United States.'
    Write-OmoSay 'Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).'
    Write-OmoSay 'Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md'
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Install-Omo -Target $OmoTarget
