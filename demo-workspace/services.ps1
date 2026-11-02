<#
.SYNOPSIS
  Starts, stops or checks the three demo services in the background (no windows). Needs Java 17 and Maven on PATH.
.EXAMPLE
  .\services.ps1 start            inventory-service 8081, order-service 8082, notification-service 8083
  .\services.ps1 start -Stub      order-service uses its in-memory inventory (inventory.mode=stub)
  .\services.ps1 start -Only order-service
  .\services.ps1 status
  .\services.ps1 stop
  Logs: %USERPROFILE%\.copilot\team\demo\<service>.log. Code changes are picked up live (Quarkus dev mode).
#>
param(
  [ValidateSet("start", "stop", "status")][string]$Action = "status",
  [string[]]$Only,
  [switch]$Stub
)
$ErrorActionPreference = "Stop"
$state = Join-Path $HOME ".copilot\team\demo"
New-Item -ItemType Directory -Force $state | Out-Null
$services = @(
  @{ name = "inventory-service";    port = 8081 },
  @{ name = "order-service";        port = 8082 },
  @{ name = "notification-service"; port = 8083 }
)
if ($Only) { $services = $services | Where-Object { $Only -contains $_.name } }

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $iar = $c.BeginConnect("127.0.0.1", $p, $null, $null); return ($iar.AsyncWaitHandle.WaitOne(500) -and $c.Connected) }
  catch { return $false } finally { $c.Close() }
}

foreach ($s in $services) {
  $dir = Join-Path $PSScriptRoot "repos\$($s.name)"
  $pidFile = Join-Path $state "$($s.name).pid"
  $log = Join-Path $state "$($s.name).log"
  switch ($Action) {
    "start" {
      if (Test-Port $s.port) { Write-Host "$($s.name): port $($s.port) already in use, not starting"; continue }
      $extra = ""
      if ($Stub -and $s.name -eq "order-service") { $extra = " -Dinventory.mode=stub" }
      $cmd = "mvn -q quarkus:dev -Dquarkus.console.enabled=false -Ddebug=false$extra > `"$log`" 2>&1"
      $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WorkingDirectory $dir -WindowStyle Hidden -PassThru
      Set-Content $pidFile $p.Id
      Write-Host "$($s.name): starting on $($s.port) (pid $($p.Id)). The first start downloads dependencies and can take minutes."
    }
    "stop" {
      if (Test-Path $pidFile) {
        $id = (Get-Content $pidFile).Trim()
        & taskkill /PID $id /T /F 2>&1 | Out-Null
        Remove-Item $pidFile -Force
        Write-Host "$($s.name): stopped"
      } else { Write-Host "$($s.name): no pid file (not started by this script)" }
    }
    "status" {
      $up = Test-Port $s.port
      Write-Host ("{0,-22} port {1}  {2}" -f $s.name, $s.port, $(if ($up) { "UP" } else { "down" }))
    }
  }
}
