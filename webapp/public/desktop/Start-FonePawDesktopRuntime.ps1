$ErrorActionPreference = "Stop"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repoZipUrl = "https://codeload.github.com/gerd03/fnpw/zip/refs/heads/main"
$runtimeRoot = Join-Path $env:LOCALAPPDATA "FonePawDesktopRuntime"
$zipPath = Join-Path $runtimeRoot "fnpw-main.zip"
$extractRoot = Join-Path $runtimeRoot "src"
$projectDir = Join-Path $extractRoot "fnpw-main"
$logPath = Join-Path $runtimeRoot "runtime-launch.log"

function Write-Log([string]$Message) {
  $stamp = (Get-Date).ToString("s")
  Add-Content -Path $logPath -Value "[$stamp] $Message"
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js + npm not found. Install Node.js from https://nodejs.org then run this launcher again."
}

Write-Log "Downloading latest runtime package..."
Invoke-WebRequest -Uri $repoZipUrl -OutFile $zipPath -UseBasicParsing

if (Test-Path $projectDir) {
  Remove-Item -Recurse -Force $projectDir
}

Write-Log "Extracting runtime package..."
Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

Push-Location $projectDir
Write-Log "Installing dependencies..."
npm install --no-audit --fund=false
Write-Log "Starting desktop runtime..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd /d `"$projectDir`" && npm run dev" -WindowStyle Minimized
Pop-Location

Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:3210"
Write-Output "Desktop runtime launched."
