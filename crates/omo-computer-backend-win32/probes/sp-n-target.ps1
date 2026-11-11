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
  [string]$Cache = (Join-Path $env:LOCALAPPDATA 'omo-sp-n'),
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

# webview2: the SDK assemblies come from the pinned NuGet package, fetched once
# into the cache and checked against its recorded sha256 on every run.
$pkgVersion = '1.0.2903.40'
$pkgSha256 = $env:SPN_WEBVIEW2_NUPKG_SHA256
$pkgDir = Join-Path $Cache "webview2-$pkgVersion"
$nupkg = Join-Path $Cache "microsoft.web.webview2.$pkgVersion.nupkg"
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
if (-not (Test-Path $nupkg)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$pkgVersion" -OutFile $nupkg
}
$actual = (Get-FileHash -Algorithm SHA256 $nupkg).Hash.ToLowerInvariant()
if ($pkgSha256 -and $actual -ne $pkgSha256.ToLowerInvariant()) { throw "webview2 package sha256 $actual does not match $pkgSha256" }
if (-not (Test-Path $pkgDir)) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($nupkg, $pkgDir)
}
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
$bin = Join-Path $Cache "webview2-bin-$arch"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item -Force (Join-Path $pkgDir 'lib\net462\Microsoft.Web.WebView2.Core.dll') $bin
Copy-Item -Force (Join-Path $pkgDir 'lib\net462\Microsoft.Web.WebView2.WinForms.dll') $bin
Copy-Item -Force (Join-Path $pkgDir "runtimes\$arch\native\WebView2Loader.dll") $bin
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
$props.UserDataFolder = Join-Path $Cache 'webview2-userdata'
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
