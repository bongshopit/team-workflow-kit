<#
.SYNOPSIS
  Starts the OTLP trial collector at every Windows logon (a scheduled task named TeamOtelCollector).

.EXAMPLE
  .\otel-task.ps1            install (or update) the task and start it now
  .\otel-task.ps1 -Status    show whether the task exists and the port is listening
  .\otel-task.ps1 -Remove    stop and delete the task
  .\otel-task.ps1 -Port 4319 use another port (point the clients at the same port)
  .\otel-task.ps1 -Dump     run the raw trial collector (otel-dump.mjs) instead of the daily one (otel-collect.mjs)
#>
param(
  [switch]$Remove,
  [switch]$Status,
  [switch]$Dump,
  [int]$Port = 4318
)

$ErrorActionPreference = "Stop"
$TaskName = "TeamOtelCollector"
$Dest = Join-Path $HOME ".copilot\team\otel"

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect("127.0.0.1", $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(800) -and $c.Connected
    return $ok
  } catch { return $false } finally { $c.Close() }
}

function Show-Status {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Host "Task $TaskName : not installed" } else {
    $i = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Task $TaskName : $($t.State), last run $($i.LastRunTime), last result $($i.LastTaskResult)"
  }
  if (Test-Port $Port) { Write-Host "Port $Port : listening" } else { Write-Host "Port $Port : NOT listening" }
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    Write-Host "Collector   : $($h.spans) spans saved, $($h.droppedMetrics) metric requests dropped, $($h.errors) errors, since $($h.startedAt)"
    Write-Host "Spool folder: $($h.spool)"
  } catch { Write-Host "Collector   : no /health answer (the raw trial collector has none, or it is not running)" }
  Write-Host "Raw dump    : $(Join-Path $HOME 'team-otel-dump')  (trial collector only)"
}

if ($Status) { Show-Status; exit 0 }

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed $TaskName."
  } else { Write-Host "$TaskName is not installed." }
  exit 0
}

# 1. Find node.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node was not found on PATH. Install Node 18 or newer and run this again." }

# 2. Copy the scripts to a fixed place so the task does not depend on the Downloads folder.
New-Item -ItemType Directory -Force $Dest | Out-Null
foreach ($f in "otel-collect.mjs", "otel-lib.mjs", "otel-report.mjs", "otel-audit.mjs", "otel-dump.mjs", "otel-summary.mjs") {
  $src = Join-Path $PSScriptRoot $f
  if (-not (Test-Path $src)) { throw "$f is not next to this script ($PSScriptRoot)." }
  Copy-Item $src $Dest -Force
}
$script = Join-Path $Dest ($(if ($Dump) { "otel-dump.mjs" } else { "otel-collect.mjs" }))

# 3. Register the task: at logon, no window, no time limit, restart if it exits.
# A tiny launcher (wscript, window style 0) starts node with no console window, so there is nothing to close by mistake.
$vbs = Join-Path $Dest "collector-run.vbs"
$tpl = @'
Set sh = CreateObject("WScript.Shell")
rc = sh.Run("""NODE"" ""SCRIPT"" --port PORT", 0, True)
WScript.Quit rc
'@
$tpl.Replace("NODE", $node).Replace("SCRIPT", $script).Replace("PORT", "$Port") | Set-Content $vbs -Encoding ASCII
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -Hidden -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Local OTLP collector for the team workflow trial" | Out-Null

# 4. Start it now, unless something already listens on the port (for example a collector you started by hand).
if (Test-Port $Port) {
  Write-Host "Port $Port is already in use. Close the collector you started by hand (Ctrl+C), then run: Start-ScheduledTask $TaskName"
} else {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
}
Show-Status
Write-Host ""
Write-Host "Running $(Split-Path $script -Leaf) in the background (no window). Installed to $Dest. Point the clients at http://127.0.0.1:$Port as in README.md."
