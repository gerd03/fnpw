[CmdletBinding()]
param(
    [string]$TaskName = 'FonePaw AutoFix To Downloads',
    [string]$ScriptPath = '',
    [switch]$ForceStartupFolder
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ScriptPath) {
    $ScriptPath = Join-Path $PSScriptRoot 'FonePaw-AutoFix.ps1'
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Auto-fix script not found: $ScriptPath"
}

$resolvedScript = (Resolve-Path -LiteralPath $ScriptPath).Path
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$resolvedScript`""
$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$startupCmd = Join-Path $startupDir 'Start-FonePawAutoFix.cmd'

function Ensure-WatcherRunning {
    param(
        [string]$ScriptFile,
        [string]$ArgString
    )
    $escapedScript = [Regex]::Escape($ScriptFile)
    $existing = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -match $escapedScript } |
        Select-Object -First 1
    if (-not $existing) {
        Start-Process -FilePath 'powershell.exe' -ArgumentList $ArgString -WindowStyle Hidden | Out-Null
        Write-Output 'Started watcher process in current session.'
    } else {
        Write-Output 'Watcher process is already running in current session.'
    }
}

function Install-StartupFallback {
    param(
        [string]$CmdPath,
        [string]$ArgString
    )

    if (-not (Test-Path -LiteralPath $startupDir)) {
        New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
    }

    $cmdContent = @(
        '@echo off'
        'start "" powershell.exe ' + $ArgString
    ) -join "`r`n"
    Set-Content -Path $CmdPath -Value $cmdContent -Encoding ASCII
    Write-Output "Installed startup fallback: $CmdPath"
}

$taskInstalled = $false

if (-not $ForceStartupFolder) {
    try {
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $TaskName
        $taskInstalled = $true
        Write-Output "Installed and started scheduled task: $TaskName"
    } catch {
        Write-Warning "Scheduled task install failed: $($_.Exception.Message)"
    }
}

if (-not $taskInstalled) {
    Install-StartupFallback -CmdPath $startupCmd -ArgString $arguments
}

Ensure-WatcherRunning -ScriptFile $resolvedScript -ArgString $arguments
Write-Output "Script: $resolvedScript"
