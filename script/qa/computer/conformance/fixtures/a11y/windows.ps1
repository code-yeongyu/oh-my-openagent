# UIA probe for the a11y leg of the fixture self-test: windows.ps1 -TargetPid <pid> -Title <window title>.
# Finds the fixture window by process id and title, then requires the page's controls to be visible in the
# UIA tree: at least one named Button and one named Edit beneath it. Renderer accessibility must already be
# forced on by the host (Electron switch / WebView2 browser arguments); querying with a real UIA client also
# lets Chromium enable its renderer tree on the spot.
# Prints "A11Y buttons=<n> entries=<m>" and exits 0 when both are visible, 1 when a control class is missing,
# 3 (ENVIRONMENT) when UIA is unreachable or the window never appears within the wait.
param(
    [Parameter(Mandatory = $true)][int]$TargetPid,
    [Parameter(Mandatory = $true)][string]$Title
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$deadline = (Get-Date).AddSeconds(20)

function Find-Window {
    $pidCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $script:TargetPid)
    $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $script:Title)
    $both = New-Object System.Windows.Automation.AndCondition($pidCondition, $nameCondition)
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $both)
}

$window = $null
while ($true) {
    try { $window = Find-Window } catch { }
    if ($null -ne $window) { break }
    if ((Get-Date) -ge $deadline) {
        Write-Output "ENVIRONMENT: no UIA window titled '$Title' for pid $TargetPid within 20s"
        exit 3
    }
    Start-Sleep -Milliseconds 500
}

$buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit)

# Count only controls inside the page (UIA Document elements): the title bar's Minimize/Maximize/Close are
# named Buttons too and would satisfy the button condition with no page control visible at all.
$documentCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document)

$deadline = (Get-Date).AddSeconds(20)
do {
    $namedButtons = @()
    $namedEdits = @()
    foreach ($document in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $documentCondition)) {
        $namedButtons += @($document.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition) | Where-Object { $_.Current.Name })
        $namedEdits += @($document.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition) | Where-Object { $_.Current.Name })
    }
    if ($namedButtons.Count -ge 1 -and $namedEdits.Count -ge 1) { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

Write-Output ("A11Y buttons={0} entries={1}" -f $namedButtons.Count, $namedEdits.Count)
if ($namedButtons.Count -ge 1 -and $namedEdits.Count -ge 1) { exit 0 }
exit 1
