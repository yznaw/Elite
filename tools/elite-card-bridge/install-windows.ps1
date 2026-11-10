#Requires -RunAsAdministrator
<#
  Installs the Elite Card Bridge on one till PC.

  Run from the folder that holds the published bridge (EliteCardBridge.exe and
  the QNB DLL files next to it), in an elevated PowerShell:

    .\install-windows.ps1 -ComPort COM3 -PosUser 'SHOP\cashier'

  It copies the bridge to %ProgramFiles(x86)%\ElitePOS\CardBridge (read-only
  for the cashier account, except the DLL's Logs folder), writes
  config.json with a new random bridge key, gives the POS Windows account
  write access to the data and DLL log folders (DLL 5.0.0.12+ refuses to run
  without its log), registers a logon task that restarts on failure, and
  prints the bridge key to enter once in POS > Settings > Card terminal.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^COM[0-9]{1,3}$')]
  [string]$ComPort,

  [Parameter(Mandatory = $true)]
  [string]$PosUser,

  [string]$AllowedOrigins = 'https://admin.elitecollections.qa',
  [string]$SourceDirectory = $PSScriptRoot,
  [string]$TaskName = 'Elite POS Card Bridge',
  # SHA-256 of Ideal.PointOfSale.Integration.dll 5.0.0.13 as delivered by QNB.
  [string]$ExpectedDllSha256 = 'f26b02c3bcaeba2bdff2cfdd05fb0cdb1f31147c86b5d5f972445de9dfea12a1'
)

$ErrorActionPreference = 'Stop'
$dataDirectory = Join-Path $env:ProgramData 'ElitePOS\card-bridge'
$appDirectory = Join-Path ${env:ProgramFiles(x86)} 'ElitePOS\CardBridge'
$exe = Join-Path $SourceDirectory 'EliteCardBridge.exe'
$dll = Join-Path $SourceDirectory 'Ideal.PointOfSale.Integration.dll'

foreach ($required in @($exe, $dll, (Join-Path $SourceDirectory 'log4net.config'))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing file: $required" }
}
$actualHash = (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $ExpectedDllSha256.ToLowerInvariant()) {
  throw "Ideal.PointOfSale.Integration.dll does not match the QNB-delivered build (SHA-256 $actualHash). Use the files from QNB."
}

# Stop a running bridge before replacing its files.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-Process EliteCardBridge -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}

New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $SourceDirectory '*') -Destination $appDirectory -Recurse -Force -Exclude 'install-windows.ps1'
New-Item -ItemType Directory -Path (Join-Path $appDirectory 'Logs') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dataDirectory 'logs') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dataDirectory 'journal') -Force | Out-Null

# Keep an existing key on reinstall so the POS does not need re-pairing.
$configPath = Join-Path $dataDirectory 'config.json'
$bridgeKey = $null
if (Test-Path -LiteralPath $configPath) {
  try { $bridgeKey = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).bridgeKey } catch { $bridgeKey = $null }
}
if (-not $bridgeKey -or $bridgeKey.Length -lt 24) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $bridgeKey = ([Convert]::ToBase64String($bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
$config = [ordered]@{
  httpPort       = 8183
  comPort        = $ComPort
  bridgeKey      = $bridgeKey
  allowedOrigins = @($AllowedOrigins.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  mode           = 'real'
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

# Data folder: only SYSTEM, Administrators and the POS account. It holds the
# bridge key, the payment journal and the DLL log.
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
foreach ($identity in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, 'None', 'Allow')))
}
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($PosUser, 'Modify', $inherit, 'None', 'Allow')))
Set-Acl -LiteralPath $dataDirectory -AclObject $acl

# Program folder stays admin-writable only (default Program Files rights); the
# DLL writes its own log under Logs\ next to the exe, so only that is opened up.
$logsAcl = Get-Acl -LiteralPath (Join-Path $appDirectory 'Logs')
$logsAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($PosUser, 'Modify', $inherit, 'None', 'Allow')))
Set-Acl -LiteralPath (Join-Path $appDirectory 'Logs') -AclObject $logsAcl

$action = New-ScheduledTaskAction -Execute (Join-Path $appDirectory 'EliteCardBridge.exe') -WorkingDirectory $appDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $PosUser
$principal = New-ScheduledTaskPrincipal -UserId $PosUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Elite POS card bridge: lets the browser till drive the QNB card terminal over the serial cable. Loopback only.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8183/v1/health' -TimeoutSec 5
  Write-Host ("Elite Card Bridge {0} is running ({1}, {2}, connected: {3})." -f $health.data.version, $health.data.mode, $health.data.comPort, $health.data.connected) -ForegroundColor Green
} catch {
  Write-Warning "The task was installed but the bridge did not answer: $($_.Exception.Message)"
  Write-Warning "Check $dataDirectory\logs\bridge.log and that $PosUser is logged on."
}

Write-Host ''
Write-Host 'Enter this bridge key once in POS > Settings > Card terminal on this till:' -ForegroundColor Yellow
Write-Host $bridgeKey
