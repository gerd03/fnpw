# FonePaw Web App Guide

## Overview

This web app provides:

1. Auto-fix of FonePaw `*.keymp4` files into playable `*.mp4`.
2. Configurable destination:
   - Downloads
   - Any custom folder
3. File browser for local FonePaw files.
4. Manual single-file or batch fixing.
5. Day grouping in UI:
   - Today
   - Yesterday
   - Earlier
6. Legacy automation guard:
   - Detect old PowerShell startup mover
   - Disable it from UI so behavior is webapp-controlled only

The core fix logic used by this app is:

- Decode only first 48 bytes with XOR `0xCD`.
- Copy the rest of file unchanged.

This avoids black/corrupted output caused by full-file decoding.

## Why It Works Across Different PCs

The app avoids hardcoded user paths by:

1. Detecting source candidates from:
   - `%LOCALAPPDATA%`
   - `%APPDATA%`
   - common FonePaw folders
2. Allowing manual folder override for both source and destination.
3. Persisting settings per-user in:
   - `%APPDATA%\FonePawFixWeb\config.json`
4. Validating absolute paths before processing.

## Project Files

- `package.json`
- `webapp/server.js`
- `webapp/public/index.html`
- `webapp/public/styles.css`
- `webapp/public/app.js`

## Install and Run

From project root:

```powershell
npm install
npm start
```

Open:

`http://localhost:3210`

## UI Workflow

1. Open **Settings**.
2. Set **Source folder**:
   - Use detected list, or
   - paste absolute folder path.
   - Optional: use **Browse** button.
3. Set **Output mode**:
   - Downloads, or
   - Custom folder.
   - Optional: use **Browse** button for custom folder.
4. Save settings.
5. Use **Automation**:
   - Start Watcher for auto-fix.
6. Open **Legacy Automation Guard**:
   - Click **Disable Legacy Auto-Mover** once on machines that previously used script mode.
6. Use **Manual Fix**:
   - Refresh files.
   - Select files.
   - Fix selected.

## API Summary

Server endpoints:

- `GET /api/status`
- `GET /api/discover-sources`
- `GET /api/files`
- `POST /api/settings`
- `POST /api/pick-folder`
- `POST /api/fix`
- `POST /api/fix-batch`
- `POST /api/watcher/start`
- `POST /api/watcher/stop`
- `POST /api/watcher/scan`
- `GET /api/legacy-status`
- `POST /api/legacy-disable`

## Error Handling Included

1. File stability checks before conversion (avoid half-written recording).
2. Temp output file then atomic rename.
3. Duplicate skip logic (same source signature).
4. Activity history + log file for troubleshooting.

Log file:

`%APPDATA%\FonePawFixWeb\webapp.log`

## Share Notes

To share with others:

1. Share this project folder.
2. Ask them to install Node.js.
3. Run `npm install` then `npm start`.
4. Configure source/destination in UI once.

No username-specific code changes are required.
