# FonePaw `.keymp4` Auto-Fix Guide (Playable MP4 in Downloads)

## 1. Problem Summary

FonePaw writes recordings as `.keymp4` in:

`C:\FonePaw Temp\FonePaw Screen Recorder\RecOut`

If you only rename `.keymp4` to `.mp4`, playback often fails or shows black video.

## 2. Root Cause

In this file format, the first 48 bytes are obfuscated with XOR `0xCD`.

- Header is obfuscated.
- Main media payload is already valid.
- Decoding the whole file damages it.

Correct fix:

1. XOR-decode only first 48 bytes.
2. Copy all remaining bytes unchanged.
3. Save output as `.mp4`.

## 3. What Was Implemented

Two scripts were created:

- `scripts/FonePaw-AutoFix.ps1`
- `scripts/Install-FonePawAutoFixTask.ps1`

### `FonePaw-AutoFix.ps1` does:

1. Watches `RecOut` (poll-based).
2. Waits until recording file is stable (not still writing).
3. Converts `*.keymp4` to playable `.mp4` in Downloads.
4. Logs activity to:
   `C:\Users\<YourUser>\AppData\Local\FonePawAutoFix\autofix.log`
5. Avoids duplicate re-processing unless source file changed.

### Output behavior

Input:

`Video_260305083148.keymp4`

Output:

`C:\Users\<YourUser>\Downloads\Video_260305083148.mp4`

## 4. Auto-Start Setup (Already Done)

Preferred method is a scheduled task:

`FonePaw AutoFix To Downloads`

It starts at user logon and runs the watcher in background.

If task creation is blocked by permissions, installer automatically falls back to Startup folder:

`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Start-FonePawAutoFix.cmd`

## 5. Manual Commands

### Install or reinstall task

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\PC2\Desktop\poweshell\scripts\Install-FonePawAutoFixTask.ps1"
```

### Force Startup-folder mode (no scheduled task)

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\PC2\Desktop\poweshell\scripts\Install-FonePawAutoFixTask.ps1" -ForceStartupFolder
```

### Run one-time conversion scan (no loop)

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\PC2\Desktop\poweshell\scripts\FonePaw-AutoFix.ps1" -RunOnce
```

### Run watcher manually in current terminal

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\PC2\Desktop\poweshell\scripts\FonePaw-AutoFix.ps1"
```

### Remove scheduled task (if needed)

```powershell
Unregister-ScheduledTask -TaskName "FonePaw AutoFix To Downloads" -Confirm:$false
```

### Remove Startup-folder autostart (if needed)

```powershell
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Start-FonePawAutoFix.cmd" -Force
```

## 6. Validation Checklist

When a new recording is created in FonePaw:

1. Confirm new `.keymp4` appears in `RecOut`.
2. Wait a few seconds after recording stops.
3. Confirm `.mp4` appears in Downloads with same base name.
4. Open the `.mp4` in VLC or Media Player.

## 7. Troubleshooting

### No file appears in Downloads

- Check task status:
  `Get-ScheduledTask -TaskName "FonePaw AutoFix To Downloads"`
- Check log:
  `Get-Content "$env:LOCALAPPDATA\FonePawAutoFix\autofix.log" -Tail 100`

### Output file exists but still not playable

- Ensure file came from this script (same size as source, `.mp4` in Downloads).
- Ensure recording has actually finished before conversion.
- Test original `.keymp4` inside FonePaw preview. If preview is black too, source recording itself is black.

## 8. Shareable Explanation (Short Version)

FonePaw `.keymp4` is not a normal renamed MP4.  
Only its first 48 bytes are obfuscated.  
Our fix decodes that header only and leaves media data unchanged.  
This produces a standard playable MP4.  
Automation now applies this fix to every new FonePaw recording and drops the result into Downloads.
