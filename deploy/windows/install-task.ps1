<#
Registers a Windows scheduled task that keeps the QA Agent UI running on this machine.

  Headed tests (default): the task starts when -User logs on, in that user's desktop session, so
  Playwright can open visible browser windows. Configure auto-logon for that account so the
  session exists after every reboot.

  -Headless: the task starts at boot without anyone logged on. Set PLAYWRIGHT_HEADED=false in .env.

Run from an elevated PowerShell:
  .\deploy\windows\install-task.ps1 -User 'VM\qa-runner'
  .\deploy\windows\install-task.ps1 -User 'VM\qa-runner' -Headless
#>
param(
  [Parameter(Mandatory = $true)][string]$User,
  [switch]$Headless,
  [string]$TaskName = 'QA Agent UI'
)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ui = Join-Path $repo 'AgentUI'
$log = Join-Path $ui 'server.log'
if (-not (Test-Path (Join-Path $repo '.env'))) { Write-Warning "No .env at $repo - copy .env.example to .env and fill it in first." }

# npm start loads ..\.env itself; output goes to AgentUI\server.log.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c npm start >> `"$log`" 2>&1" -WorkingDirectory $ui
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

if ($Headless) {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
  $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered '$TaskName' ($(if ($Headless) { 'at startup, headless' } else { "at logon of $User, headed" })). Log: $log"
Write-Host "Start it now with: Start-ScheduledTask -TaskName '$TaskName'"
