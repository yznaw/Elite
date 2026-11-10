#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CertificatePath,

  [Parameter(Mandatory = $true)]
  [string]$PrivateKeyPath,

  [Parameter(Mandatory = $true)]
  [string]$AllowedOrigins,

  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [string]$TaskName = 'Elite POS Device Signer'
)

$ErrorActionPreference = 'Stop'
$installDirectory = Join-Path $env:ProgramData 'ElitePOS\device-signer'
$runnerPath = Join-Path $installDirectory 'start-signer.ps1'

foreach ($requiredPath in @($CertificatePath, $PrivateKeyPath, $NodePath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required file does not exist: $requiredPath"
  }
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'index.js') -Destination $installDirectory -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Destination $installDirectory -Force

$runner = @"
`$ErrorActionPreference = 'Stop'
`$env:ELITE_POS_QZ_CERT_PATH = '$($CertificatePath.Replace("'", "''"))'
`$env:ELITE_POS_QZ_KEY_PATH = '$($PrivateKeyPath.Replace("'", "''"))'
`$env:ELITE_POS_ALLOWED_ORIGINS = '$($AllowedOrigins.Replace("'", "''"))'
`$env:ELITE_POS_SIGNER_PORT = '8182'
Set-Location -LiteralPath '$($installDirectory.Replace("'", "''"))'
`$logDirectory = Join-Path '$($installDirectory.Replace("'", "''"))' 'logs'
`$logPath = Join-Path `$logDirectory 'signer.log'
New-Item -ItemType Directory -Path `$logDirectory -Force | Out-Null

# Rotate at 5 MiB and keep five previous files. Rotation happens whenever the
# scheduled task starts/restarts, so a crash loop cannot grow one file forever.
if ((Test-Path -LiteralPath `$logPath) -and (Get-Item -LiteralPath `$logPath).Length -ge 5MB) {
  Remove-Item -LiteralPath "`$logPath.5" -Force -ErrorAction SilentlyContinue
  for (`$i = 4; `$i -ge 1; `$i--) {
    `$source = "`$logPath.`$i"
    `$target = "`$logPath.`$(`$i + 1)"
    if (Test-Path -LiteralPath `$source) { Move-Item -LiteralPath `$source -Destination `$target -Force }
  }
  Move-Item -LiteralPath `$logPath -Destination "`$logPath.1" -Force
}

& '$($NodePath.Replace("'", "''"))' 'index.js' *>> `$logPath
exit `$LASTEXITCODE
"@
Set-Content -LiteralPath $runnerPath -Value $runner -Encoding UTF8

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Starts the loopback-only Elite QZ signer at POS user logon and restarts it after failure.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8182/health' -TimeoutSec 5
  if ($health.StatusCode -ne 200 -or $health.Content.Trim() -ne 'ok') {
    throw "Unexpected health response: $($health.StatusCode) $($health.Content)"
  }
  Write-Host 'Elite POS device signer is installed, running, and healthy.' -ForegroundColor Green
} catch {
  Write-Warning "The task was installed, but the signer health check failed: $($_.Exception.Message)"
  Write-Warning "Inspect Task Scheduler > $TaskName and confirm the certificate/key permissions."
}
