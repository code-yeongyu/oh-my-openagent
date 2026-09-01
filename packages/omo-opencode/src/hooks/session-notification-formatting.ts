export function escapeAppleScriptText(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function escapePowerShellSingleQuotedText(input: string): string {
  return input.replace(/'/g, "''")
}

export function buildWindowsToastScript(title: string, message: string): string {
  const psTitle = escapePowerShellSingleQuotedText(title)
  const psMessage = escapePowerShellSingleQuotedText(message)

  return `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$Template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$RawXml = [xml] $Template.GetXml()
($RawXml.toast.visual.binding.text | Where-Object {$_.id -eq '1'}).AppendChild($RawXml.CreateTextNode('${psTitle}')) | Out-Null
($RawXml.toast.visual.binding.text | Where-Object {$_.id -eq '2'}).AppendChild($RawXml.CreateTextNode('${psMessage}')) | Out-Null
$SerializedXml = New-Object Windows.Data.Xml.Dom.XmlDocument
$SerializedXml.LoadXml($RawXml.OuterXml)
$Toast = [Windows.UI.Notifications.ToastNotification]::new($SerializedXml)
$Notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('OpenCode')
$Notifier.Show($Toast)
`.trim().replace(/\n/g, "; ")
}
