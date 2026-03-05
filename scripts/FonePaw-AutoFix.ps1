[CmdletBinding()]
param(
    [string]$SourceDir = 'C:\FonePaw Temp\FonePaw Screen Recorder\RecOut',
    [string]$OutputDir = '',
    [string]$LogFile = '',
    [int]$PollSeconds = 5,
    [switch]$RunOnce
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $OutputDir) {
    $OutputDir = Join-Path $env:USERPROFILE 'Downloads'
}

if (-not $LogFile) {
    $LogFile = Join-Path $env:LOCALAPPDATA 'FonePawAutoFix\autofix.log'
}

if ($PollSeconds -lt 2) {
    $PollSeconds = 2
}

function Write-Log {
    param([string]$Message)
    $timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "[$timestamp] $Message"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Wait-FileReady {
    param(
        [string]$Path,
        [int]$StableChecks = 3,
        [int]$SleepSeconds = 2,
        [int]$MaxWaitSeconds = 360
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }

    $deadline = (Get-Date).AddSeconds($MaxWaitSeconds)
    $lastSize = -1L
    $stableCount = 0

    while ((Get-Date) -lt $deadline) {
        try {
            $item = Get-Item -LiteralPath $Path -ErrorAction Stop
            $currentSize = [int64]$item.Length
        } catch {
            Start-Sleep -Seconds $SleepSeconds
            continue
        }

        if ($currentSize -gt 0 -and $currentSize -eq $lastSize) {
            $stableCount++
        } else {
            $stableCount = 0
            $lastSize = $currentSize
        }

        if ($stableCount -ge $StableChecks) {
            try {
                $stream = [System.IO.File]::Open(
                    $Path,
                    [System.IO.FileMode]::Open,
                    [System.IO.FileAccess]::Read,
                    [System.IO.FileShare]::Read
                )
                $stream.Dispose()
                return $true
            } catch {
                # File is still being held by another process.
            }
        }

        Start-Sleep -Seconds $SleepSeconds
    }

    return $false
}

function Convert-KeyMp4ToMp4 {
    param(
        [string]$InputPath,
        [string]$OutputDirectory
    )

    $inputItem = Get-Item -LiteralPath $InputPath -ErrorAction Stop
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($inputItem.Name)
    $outputPath = Join-Path $OutputDirectory ($baseName + '.mp4')
    $tempPath = $outputPath + '.tmp'

    if (Test-Path -LiteralPath $outputPath) {
        $existing = Get-Item -LiteralPath $outputPath
        if (
            $existing.Length -eq $inputItem.Length -and
            $existing.LastWriteTimeUtc -ge $inputItem.LastWriteTimeUtc
        ) {
            return $outputPath
        }
    }

    if (-not (Wait-FileReady -Path $InputPath)) {
        throw "File did not become ready in time: $InputPath"
    }

    $inStream = $null
    $outStream = $null
    try {
        $inStream = [System.IO.File]::Open(
            $InputPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $outStream = [System.IO.File]::Open(
            $tempPath,
            [System.IO.FileMode]::Create,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )

        # FonePaw keymp4: only the first 48 bytes are XOR-obfuscated with 0xCD.
        $headerSize = [Math]::Min(48, [int]$inStream.Length)
        $header = New-Object byte[] $headerSize
        $readHeader = $inStream.Read($header, 0, $headerSize)
        for ($i = 0; $i -lt $readHeader; $i++) {
            $header[$i] = $header[$i] -bxor 0xCD
        }
        $outStream.Write($header, 0, $readHeader)

        $buffer = New-Object byte[] 1048576
        while (($bytesRead = $inStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $outStream.Write($buffer, 0, $bytesRead)
        }
    } finally {
        if ($outStream) {
            $outStream.Dispose()
        }
        if ($inStream) {
            $inStream.Dispose()
        }
    }

    Move-Item -LiteralPath $tempPath -Destination $outputPath -Force
    return $outputPath
}

function Invoke-Scan {
    param([hashtable]$State)

    if (-not (Test-Path -LiteralPath $SourceDir)) {
        Write-Log "Source folder not found: $SourceDir"
        return
    }

    $seen = @{}
    $files = Get-ChildItem -LiteralPath $SourceDir -Filter '*.keymp4' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc

    foreach ($file in $files) {
        $seen[$file.FullName] = $true
        $signature = "$($file.Length)|$($file.LastWriteTimeUtc.Ticks)"

        if ($State.ContainsKey($file.FullName) -and $State[$file.FullName] -eq $signature) {
            continue
        }

        try {
            $outPath = Convert-KeyMp4ToMp4 -InputPath $file.FullName -OutputDirectory $OutputDir
            $State[$file.FullName] = $signature
            Write-Log "Fixed: '$($file.FullName)' -> '$outPath'"
        } catch {
            Write-Log "ERROR fixing '$($file.FullName)': $($_.Exception.Message)"
        }
    }

    foreach ($key in @($State.Keys)) {
        if (-not $seen.ContainsKey($key)) {
            $State.Remove($key)
        }
    }
}

Ensure-Directory -Path $OutputDir
Ensure-Directory -Path (Split-Path -Path $LogFile -Parent)

Write-Log "Watcher started. Source='$SourceDir' Output='$OutputDir' PollSeconds=$PollSeconds RunOnce=$RunOnce"

$state = @{}
Invoke-Scan -State $state

if ($RunOnce) {
    Write-Log 'RunOnce complete.'
    exit 0
}

while ($true) {
    Start-Sleep -Seconds $PollSeconds
    Invoke-Scan -State $state
}
