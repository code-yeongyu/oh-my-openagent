# SP-N target windows. One process per window; each writes what it observed to
# a state file (JSON) so the probe reads the effect of an input from the target
# itself, independent of the route that sent it.
#   -Kind edit      WinForms TextBox (a classic EDIT superclass) plus a wheel counter
#   -Kind wpf       WPF TextBox in an HwndWrapper window
#   -Kind webview2  WebView2 control hosting a <textarea>
param(
  [Parameter(Mandatory = $true)][ValidateSet('edit', 'wpf', 'webview2')][string]$Kind,
  [Parameter(Mandatory = $true)][string]$State,
  [Parameter(Mandatory = $true)][string]$Title,
  # download cache for the WebView2 nupkg only; nothing loaded is taken from it unverified
  [string]$Cache = (Join-Path $env:LOCALAPPDATA 'omo-sp-n'),
  # webview2: a per-run directory in the probe's administrators-only shared directory; must not exist yet
  [string]$Work = '',
  [int]$X = 120,
  [int]$Y = 120
)
$ErrorActionPreference = 'Stop'

function Write-State([hashtable]$s) {
  $s['pid'] = $PID
  $s['kind'] = $Kind
  $s['at'] = [DateTime]::UtcNow.ToString('o')
  $tmp = "$State.tmp"
  [IO.File]::WriteAllText($tmp, ($s | ConvertTo-Json -Compress))
  if (Test-Path $State) { Remove-Item -Force $State }
  Move-Item -Force $tmp $State
}

if ($Kind -eq 'edit') {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $Title
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point($X, $Y)
  $form.Size = New-Object System.Drawing.Size(520, 360)
  $box = New-Object System.Windows.Forms.TextBox
  $box.Multiline = $true
  $box.ScrollBars = 'Vertical'
  $box.Dock = 'Fill'
  $form.Controls.Add($box)
  $script:wheel = 0
  $box.Add_TextChanged({ Write-State @{ ready = $true; text = $box.Text; wheel = $script:wheel; editHwnd = [int64]$box.Handle } })
  $box.Add_MouseWheel({ $script:wheel++; Write-State @{ ready = $true; text = $box.Text; wheel = $script:wheel; editHwnd = [int64]$box.Handle } })
  $form.Add_Shown({ $box.Focus() | Out-Null; Write-State @{ ready = $true; text = $box.Text; wheel = 0; editHwnd = [int64]$box.Handle } })
  [System.Windows.Forms.Application]::Run($form)
  exit 0
}

if ($Kind -eq 'wpf') {
  Add-Type -AssemblyName PresentationFramework
  $win = New-Object System.Windows.Window
  $win.Title = $Title
  $win.Width = 520
  $win.Height = 360
  $win.Left = $X
  $win.Top = $Y
  $win.WindowStartupLocation = 'Manual'
  $box = New-Object System.Windows.Controls.TextBox
  $box.AcceptsReturn = $true
  $win.Content = $box
  $box.Add_TextChanged({ Write-State @{ ready = $true; text = $box.Text } })
  $win.Add_ContentRendered({ $box.Focus() | Out-Null; [System.Windows.Input.Keyboard]::Focus($box) | Out-Null; Write-State @{ ready = $true; text = $box.Text } })
  $app = New-Object System.Windows.Application
  $app.Run($win) | Out-Null
  exit 0
}

# webview2: the SDK assemblies come from the pinned NuGet package. Its sha256 is recorded here (and in
# probe-sp-n.ts) and checked on every run; the bytes that are hashed are the bytes that are extracted, into a
# fresh per-run directory ($Work) that only SYSTEM and Administrators can write. No extracted copy is reused.
$pkgVersion = '1.0.2903.40'
$pkgSha256 = 'ef128016dd1e51c59178c827ed5b8aa3322c57afa8675d930f8109505542ad74'
if (-not $Work) { throw 'webview2 needs -Work <per-run directory>' }
if (Test-Path -LiteralPath $Work) { throw "refused: $Work already exists" }
$nupkg = Join-Path $Cache "microsoft.web.webview2.$pkgVersion.nupkg"
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
if (-not (Test-Path -LiteralPath $nupkg)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$pkgVersion" -OutFile $nupkg
}
$bytes = [IO.File]::ReadAllBytes($nupkg)
$sha = [Security.Cryptography.SHA256]::Create()
$actual = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
if ($actual -ne $pkgSha256) { Remove-Item -LiteralPath $nupkg -Force; throw "webview2 package sha256 $actual does not match the recorded $pkgSha256" }
Add-Type -AssemblyName System.IO.Compression
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
$bin = Join-Path $Work 'bin'
New-Item -ItemType Directory -Path $bin | Out-Null
$zip = New-Object IO.Compression.ZipArchive((New-Object IO.MemoryStream(, $bytes)), [IO.Compression.ZipArchiveMode]::Read)
foreach ($entry in @('lib/net462/Microsoft.Web.WebView2.Core.dll', 'lib/net462/Microsoft.Web.WebView2.WinForms.dll', "runtimes/$arch/native/WebView2Loader.dll")) {
  $e = $zip.GetEntry($entry)
  if (-not $e) { throw "webview2 package has no $entry" }
  $in = $e.Open(); $out = [IO.File]::Create((Join-Path $bin (Split-Path -Leaf $entry)))
  $in.CopyTo($out); $out.Dispose(); $in.Dispose()
}
$zip.Dispose()
$env:PATH = "$bin;$env:PATH"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Path (Join-Path $bin 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $bin 'Microsoft.Web.WebView2.WinForms.dll')
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point($X, $Y)
$form.Size = New-Object System.Drawing.Size(520, 360)
$wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$props = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$props.UserDataFolder = Join-Path $Work 'userdata'
$wv.CreationProperties = $props
$wv.Dock = 'Fill'
$form.Controls.Add($wv)
$html = @'
<!doctype html><html><body style="margin:0"><textarea id="t" autofocus style="width:100%;height:300px"></textarea>
<script>
const t = document.getElementById('t');
const send = () => window.chrome.webview.postMessage(t.value);
t.addEventListener('input', send);
window.addEventListener('load', () => { t.focus(); send(); });
</script></body></html>
'@
$wv.Add_CoreWebView2InitializationCompleted({ $wv.CoreWebView2.NavigateToString($html) })
$wv.Add_WebMessageReceived({ param($s, $e) Write-State @{ ready = $true; text = $e.TryGetWebMessageAsString(); nupkgSha256 = $actual } })
$form.Add_Shown({ $wv.EnsureCoreWebView2Async($null) | Out-Null })
[System.Windows.Forms.Application]::Run($form)
