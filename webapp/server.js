const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

const appDataRoot =
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const appStateDir = path.join(appDataRoot, "FonePawFixWeb");
const configPath = path.join(appStateDir, "config.json");
const logPath = path.join(appStateDir, "webapp.log");

const defaultConfig = {
  sourceDir: "",
  outputMode: "downloads",
  outputDir: path.join(os.homedir(), "Downloads"),
  outputFormat: "mp4",
  pollSeconds: 5,
  autoStartWatcher: false,
  includeNonKeyFiles: false,
};

const outputFormatProfiles = {
  mp4: {
    ext: ".mp4",
    needsFfmpeg: false,
    ffmpegArgs: [],
  },
  mov: {
    ext: ".mov",
    needsFfmpeg: true,
    ffmpegArgs: ["-c", "copy"],
  },
  mkv: {
    ext: ".mkv",
    needsFfmpeg: true,
    ffmpegArgs: ["-c", "copy"],
  },
  wmv: {
    ext: ".wmv",
    needsFfmpeg: true,
    ffmpegArgs: ["-c:v", "wmv2", "-b:v", "2500k", "-c:a", "wmav2", "-b:a", "128k"],
  },
  webm: {
    ext: ".webm",
    needsFfmpeg: true,
    ffmpegArgs: ["-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-c:a", "libopus", "-b:a", "96k"],
  },
  f4v: {
    ext: ".f4v",
    needsFfmpeg: true,
    ffmpegArgs: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k"],
  },
  mpegts: {
    ext: ".ts",
    needsFfmpeg: true,
    ffmpegArgs: ["-c", "copy", "-f", "mpegts"],
  },
  gif: {
    ext: ".gif",
    needsFfmpeg: true,
    ffmpegArgs: ["-vf", "fps=12,scale=960:-1:flags=lanczos", "-loop", "0", "-an"],
  },
};

const outputFormatAliases = {
  "mpeg-ts": "mpegts",
  mpeg_ts: "mpegts",
  ts: "mpegts",
};

let ffmpegBinaryPathCache = null;

const startupDir = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup"
);
const legacyStartupCmd = path.join(startupDir, "Start-FonePawAutoFix.cmd");
const legacyScriptPattern = "FonePaw-AutoFix.ps1";

const history = [];
const MAX_HISTORY = 300;

const watcherState = {
  running: false,
  isScanning: false,
  timer: null,
  lastScanAt: null,
  processedSignatures: new Map(),
};

let config = null;

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeLog(line) {
  try {
    ensureDirSync(appStateDir);
    const stamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${stamp}] ${line}\n`, "utf8");
  } catch {
    // Ignore logging failures.
  }
}

function pushHistory(entry) {
  const item = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  history.push(item);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  const summary = `${item.type || "event"} ${item.status || "info"}: ${
    item.message || ""
  }`;
  writeLog(summary);
}

function isTruthy(value) {
  if (typeof value === "boolean") return value;
  const lower = String(value || "").toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes" || lower === "on";
}

function normalizeAbsoluteDir(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (!path.isAbsolute(value)) return "";
  return path.normalize(value);
}

function normalizeAbsoluteFile(input) {
  const value = String(input || "").trim();
  if (!value || !path.isAbsolute(value)) return "";
  return path.normalize(value);
}

function normalizeOutputFormat(format) {
  const raw = String(format || "").trim().toLowerCase();
  const normalized = outputFormatAliases[raw] || raw;
  if (Object.prototype.hasOwnProperty.call(outputFormatProfiles, normalized)) {
    return normalized;
  }
  return "mp4";
}

function getOutputFormatProfile(format) {
  return outputFormatProfiles[normalizeOutputFormat(format)];
}

function isSupportedEncryptedVideoExt(ext) {
  return String(ext || "").toLowerCase().startsWith(".key");
}

function sanitizeConfig(raw) {
  const merged = { ...defaultConfig, ...(raw || {}) };

  const sourceDir = normalizeAbsoluteDir(merged.sourceDir);
  const outputDir = normalizeAbsoluteDir(merged.outputDir);
  const outputMode = merged.outputMode === "custom" ? "custom" : "downloads";
  const outputFormat = normalizeOutputFormat(merged.outputFormat);

  let pollSeconds = Number.parseInt(String(merged.pollSeconds), 10);
  if (!Number.isFinite(pollSeconds)) {
    pollSeconds = defaultConfig.pollSeconds;
  }
  pollSeconds = Math.max(2, Math.min(300, pollSeconds));

  return {
    sourceDir,
    outputMode,
    outputDir: outputDir || defaultConfig.outputDir,
    outputFormat,
    pollSeconds,
    autoStartWatcher: Boolean(merged.autoStartWatcher),
    includeNonKeyFiles: Boolean(merged.includeNonKeyFiles),
  };
}

function saveConfig(nextConfig) {
  ensureDirSync(appStateDir);
  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
}

function toPowerShellSingleQuoted(text) {
  return `'${String(text || "").replace(/'/g, "''")}'`;
}

function toPowerShellEncodedCommand(script) {
  return Buffer.from(String(script || ""), "utf16le").toString("base64");
}

function runPowerShell(script, timeoutMs = 15000, options = {}) {
  const useSta = Boolean(options.sta);
  const hideWindow = options.windowsHide !== false;
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass"];
  if (useSta) {
    args.push("-STA");
  }
  args.push("-EncodedCommand", toPowerShellEncodedCommand(script));

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      args,
      { timeout: timeoutMs, windowsHide: hideWindow, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr?.trim() || stdout?.trim() || error.message || "PowerShell command failed."
            )
          );
          return;
        }
        resolve((stdout || "").trim());
      }
    );
  });
}

function runExecFile(command, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr?.trim() || stdout?.trim() || error.message || `${command} failed.`
            )
          );
          return;
        }
        resolve((stdout || "").trim());
      }
    );
  });
}

async function resolveFfmpegBinary() {
  if (ffmpegBinaryPathCache !== null) {
    return ffmpegBinaryPathCache;
  }

  try {
    const output = await runExecFile("where", ["ffmpeg"], 10000);
    const resolved = String(output || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    ffmpegBinaryPathCache = resolved || "";
    return ffmpegBinaryPathCache;
  } catch {
    ffmpegBinaryPathCache = "";
    return ffmpegBinaryPathCache;
  }
}

function getLegacyPidsFromWmic() {
  return new Promise((resolve, reject) => {
    const query = `name='powershell.exe' and CommandLine like '%${legacyScriptPattern}%'`;
    execFile(
      "wmic",
      ["process", "where", query, "get", "ProcessId", "/value"],
      { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          if (error.code === "ENOENT") {
            const fallbackScript = `
$selfPid = $PID
$procs = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.ProcessId -ne $selfPid -and $_.CommandLine -like '*${legacyScriptPattern}*' }
@($procs | ForEach-Object { $_.ProcessId }) -join ','
`;
            runPowerShell(fallbackScript, 15000)
              .then((raw) => {
                const pids = String(raw || "")
                  .split(",")
                  .map((x) => Number.parseInt(x.trim(), 10))
                  .filter((n) => Number.isFinite(n) && n > 0);
                resolve(pids);
              })
              .catch((fallbackErr) => {
                reject(fallbackErr);
              });
            return;
          }
          reject(
            new Error(
              stderr?.trim() || stdout?.trim() || error.message || "WMIC query failed."
            )
          );
          return;
        }
        const pids = [];
        const regex = /ProcessId=(\d+)/g;
        let match = null;
        while ((match = regex.exec(stdout || "")) !== null) {
          const pid = Number.parseInt(match[1], 10);
          if (Number.isFinite(pid) && pid > 0) {
            pids.push(pid);
          }
        }
        resolve(pids);
      }
    );
  });
}

async function pickFolderDialog(initialPath = "") {
  const normalized = normalizeAbsoluteDir(initialPath);
  const psPath = toPowerShellSingleQuoted(normalized || "");
  const script = `
$ErrorActionPreference = 'Stop'
$seed = ${psPath}
try {
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Select folder'
  $dialog.ShowNewFolderButton = $true
  if($seed -and (Test-Path -LiteralPath $seed)){ $dialog.SelectedPath = $seed }
  $result = $dialog.ShowDialog()
  if($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath){ Write-Output $dialog.SelectedPath }
} catch {
  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.BrowseForFolder(0, 'Select folder', 0, $seed)
  if($folder -and $folder.Self -and $folder.Self.Path){ Write-Output $folder.Self.Path }
}
`;
  const output = await runPowerShell(script, 60000, { sta: true, windowsHide: false });
  return output || "";
}

async function getLegacyAutomationStatus() {
  const startupExists = fs.existsSync(legacyStartupCmd);
  const runningPids = await getLegacyPidsFromWmic();
  return {
    startupExists,
    runningCount: runningPids.length,
    runningPids,
  };
}

async function disableLegacyAutomation() {
  let removedStartup = false;
  if (fs.existsSync(legacyStartupCmd)) {
    await fsp.unlink(legacyStartupCmd);
    removedStartup = true;
  }

  const runningPids = await getLegacyPidsFromWmic();
  const stoppedPids = [];
  for (const pid of runningPids) {
    try {
      process.kill(pid, "SIGTERM");
      stoppedPids.push(pid);
    } catch {
      // Ignore process kill failures.
    }
  }

  return {
    removedStartup,
    stoppedCount: stoppedPids.length,
    stoppedPids,
  };
}

function getDefaultSourceCandidates() {
  const home = os.homedir();
  const localAppData =
    process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");

  const candidates = [
    process.env.FONEPAW_SOURCE_DIR || "",
    "C:\\FonePaw Temp\\FonePaw Screen Recorder\\RecOut",
    path.join(
      localAppData,
      "Temp",
      "FonePaw",
      "FonePaw Screen Recorder",
      "RecOut"
    ),
    path.join(localAppData, "FonePaw", "FonePaw Screen Recorder", "RecOut"),
  ];

  return [...new Set(candidates.map(normalizeAbsoluteDir).filter(Boolean))];
}

function discoverSourceDirsQuick() {
  const discovered = new Set();
  const home = os.homedir();
  const homeRoot = path.parse(home).root;
  const userRelative = path.relative(homeRoot, home);

  for (const candidate of getDefaultSourceCandidates()) {
    if (candidate && fs.existsSync(candidate)) {
      discovered.add(path.normalize(candidate));
    }
  }

  for (let code = 67; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const driveRoot = `${letter}:\\`;
    if (!fs.existsSync(driveRoot)) continue;

    const candidate1 = path.join(
      driveRoot,
      "FonePaw Temp",
      "FonePaw Screen Recorder",
      "RecOut"
    );
    const candidate2 = path.join(
      driveRoot,
      userRelative,
      "AppData",
      "Local",
      "Temp",
      "FonePaw",
      "FonePaw Screen Recorder",
      "RecOut"
    );

    if (fs.existsSync(candidate1)) discovered.add(path.normalize(candidate1));
    if (fs.existsSync(candidate2)) discovered.add(path.normalize(candidate2));
  }

  return [...discovered];
}

function loadConfig() {
  ensureDirSync(appStateDir);

  let loaded = {};
  if (fs.existsSync(configPath)) {
    try {
      loaded = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      loaded = {};
    }
  }

  let next = sanitizeConfig(loaded);
  if (!next.sourceDir) {
    const discovered = discoverSourceDirsQuick();
    if (discovered.length > 0) {
      next.sourceDir = discovered[0];
    }
  }

  saveConfig(next);
  return next;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForFileStable(filePath, options = {}) {
  const stableChecks = options.stableChecks || 3;
  const delayMs = options.delayMs || 1500;
  const maxWaitMs = options.maxWaitMs || 360000;

  const deadline = Date.now() + maxWaitMs;
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() < deadline) {
    let stat = null;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      await sleep(delayMs);
      continue;
    }

    if (stat.size > 0 && stat.size === lastSize) {
      stableCount += 1;
    } else {
      stableCount = 0;
      lastSize = stat.size;
    }

    if (stableCount >= stableChecks) {
      try {
        const handle = await fsp.open(filePath, "r");
        await handle.close();
        return true;
      } catch {
        // Ignore and continue waiting.
      }
    }

    await sleep(delayMs);
  }

  return false;
}

function getDayGroup(mtimeMs) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday.getTime() - 24 * 60 * 60 * 1000);
  const mtime = new Date(mtimeMs);

  if (mtime >= startToday) return "today";
  if (mtime >= startYesterday) return "yesterday";
  return "earlier";
}

async function listFilesRecursive(rootDir) {
  const normalizedRoot = normalizeAbsoluteDir(rootDir);
  if (!normalizedRoot) {
    return [];
  }

  let rootStat = null;
  try {
    rootStat = await fsp.stat(normalizedRoot);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) {
    return [];
  }

  const stack = [normalizedRoot];
  const files = [];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      let stat = null;
      try {
        stat = await fsp.stat(fullPath);
      } catch {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const isFixable = isSupportedEncryptedVideoExt(ext);
      const isKeyMp4 = ext === ".keymp4";
      files.push({
        name: entry.name,
        fullPath,
        ext,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        mtimeIso: new Date(stat.mtimeMs).toISOString(),
        isFixable,
        isKeyMp4,
        group: getDayGroup(stat.mtimeMs),
      });
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

async function decodeEncryptedVideoToMp4(sourcePath, outputMp4Path, inputStat) {
  const tempPath = `${outputMp4Path}.tmp`;

  try {
    await fsp.unlink(tempPath);
  } catch {
    // Ignore if temp file does not exist.
  }

  let inHandle = null;
  let outHandle = null;

  try {
    inHandle = await fsp.open(sourcePath, "r");
    outHandle = await fsp.open(tempPath, "w");

    const headerLen = Math.min(48, inputStat.size);
    const header = Buffer.alloc(headerLen);
    if (headerLen > 0) {
      const readResult = await inHandle.read(header, 0, headerLen, 0);
      for (let i = 0; i < readResult.bytesRead; i += 1) {
        header[i] = header[i] ^ 0xcd;
      }
      await outHandle.write(header, 0, readResult.bytesRead, 0);
    }

    const chunk = Buffer.alloc(1024 * 1024);
    let readPosition = headerLen;
    let writePosition = headerLen;

    while (readPosition < inputStat.size) {
      const remaining = inputStat.size - readPosition;
      const toRead = Math.min(chunk.length, remaining);
      const { bytesRead } = await inHandle.read(chunk, 0, toRead, readPosition);
      if (bytesRead <= 0) {
        break;
      }
      await outHandle.write(chunk, 0, bytesRead, writePosition);
      readPosition += bytesRead;
      writePosition += bytesRead;
    }
  } catch (error) {
    try {
      await fsp.unlink(tempPath);
    } catch {
      // Ignore cleanup failure.
    }
    throw error;
  } finally {
    if (outHandle) await outHandle.close();
    if (inHandle) await inHandle.close();
  }

  await fsp.rename(tempPath, outputMp4Path);
}

async function convertWithFfmpeg(inputPath, outputPath, formatKey) {
  const binary = await resolveFfmpegBinary();
  if (!binary) {
    throw new Error(
      "FFmpeg is required for this format. Install FFmpeg and ensure `ffmpeg` is in PATH, or use MP4."
    );
  }

  const profile = getOutputFormatProfile(formatKey);
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    ...profile.ffmpegArgs,
    outputPath,
  ];
  await runExecFile(binary, args, 20 * 60 * 1000);
}

function resolveOutputTarget(inputPath, outputDir, outputFormat = "mp4") {
  const source = normalizeAbsoluteFile(inputPath);
  const targetDir = normalizeAbsoluteDir(outputDir);
  const formatKey = normalizeOutputFormat(outputFormat);
  const profile = getOutputFormatProfile(formatKey);

  if (!source) {
    throw new Error("Input path must be an absolute file path.");
  }
  if (!targetDir) {
    throw new Error("Output directory must be an absolute path.");
  }
  if (!isSupportedEncryptedVideoExt(path.extname(source).toLowerCase())) {
    throw new Error("Only FonePaw encrypted video files (.key*) are supported.");
  }

  const baseName = path.basename(source, path.extname(source));
  const outputPath = path.join(targetDir, `${baseName}${profile.ext}`);

  return {
    source,
    targetDir,
    formatKey,
    outputPath,
  };
}

async function convertEncryptedVideo(inputPath, outputDir, outputFormat = "mp4") {
  const { source, targetDir, formatKey, outputPath } = resolveOutputTarget(
    inputPath,
    outputDir,
    outputFormat
  );

  const inputStat = await fsp.stat(source);
  if (!inputStat.isFile()) {
    throw new Error("Input path is not a file.");
  }

  const stable = await waitForFileStable(source);
  if (!stable) {
    throw new Error("Source file is still being written. Try again.");
  }

  await fsp.mkdir(targetDir, { recursive: true });

  let existedBefore = false;

  try {
    const existing = await fsp.stat(outputPath);
    existedBefore = existing.isFile() && existing.size > 0;
    if (existing.isFile() && existing.size > 0 && existing.mtimeMs >= inputStat.mtimeMs) {
      return {
        outputPath,
        skipped: true,
        existedBefore: true,
        outputFormat: formatKey,
      };
    }
  } catch {
    // Output does not exist. Continue.
  }

  if (formatKey === "mp4") {
    await decodeEncryptedVideoToMp4(source, outputPath, inputStat);
  } else {
    const intermediateMp4 = path.join(
      targetDir,
      `${baseName}.decoded.${process.pid}.${Date.now()}.mp4`
    );
    try {
      await decodeEncryptedVideoToMp4(source, intermediateMp4, inputStat);
      await convertWithFfmpeg(intermediateMp4, outputPath, formatKey);
    } finally {
      try {
        await fsp.unlink(intermediateMp4);
      } catch {
        // Ignore cleanup failure.
      }
    }
  }

  try {
    await fsp.utimes(outputPath, new Date(), inputStat.mtime);
  } catch {
    // Ignore metadata copy failures.
  }

  return {
    outputPath,
    skipped: false,
    existedBefore,
    outputFormat: formatKey,
  };
}

function resolveDestinationDir(destinationMode, destinationDir) {
  const mode = destinationMode === "custom" ? "custom" : "downloads";
  if (mode === "downloads") {
    return path.join(os.homedir(), "Downloads");
  }

  const normalized = normalizeAbsoluteDir(destinationDir);
  if (!normalized) {
    throw new Error("For custom destination, provide an absolute output folder.");
  }
  return normalized;
}

async function openPathInExplorer(action, targetPath) {
  const normalized = normalizeAbsoluteFile(targetPath) || normalizeAbsoluteDir(targetPath);
  if (!normalized) {
    throw new Error("targetPath must be an absolute path.");
  }

  let stat = null;
  try {
    stat = await fsp.stat(normalized);
  } catch {
    throw new Error("Target path does not exist.");
  }

  if (action === "reveal_file") {
    if (!stat.isFile()) {
      throw new Error("Reveal action requires a file path.");
    }
    await runExecFile("explorer.exe", [`/select,${normalized}`], 15000);
    return;
  }

  if (action === "open_folder") {
    const folder = stat.isDirectory() ? normalized : path.dirname(normalized);
    await runExecFile("explorer.exe", [folder], 15000);
    return;
  }

  if (action === "open_file") {
    if (!stat.isFile()) {
      throw new Error("Open file action requires a file path.");
    }
    const script = `Start-Process -FilePath ${toPowerShellSingleQuoted(normalized)}`;
    await runPowerShell(script, 15000, { windowsHide: false });
    return;
  }

  throw new Error("Unsupported action.");
}

async function runWatcherScan(trigger = "manual") {
  if (watcherState.isScanning) return;
  watcherState.isScanning = true;

  try {
    if (!config.sourceDir || !fs.existsSync(config.sourceDir)) {
      pushHistory({
        type: "watch-scan",
        status: "warning",
        message: `Source folder missing: ${config.sourceDir || "(not set)"}`,
      });
      return;
    }

    const files = await listFilesRecursive(config.sourceDir);
    const keyFiles = files.filter((f) => f.isFixable);
    const keepSet = new Set(keyFiles.map((f) => f.fullPath));

    for (const knownPath of [...watcherState.processedSignatures.keys()]) {
      if (!keepSet.has(knownPath)) {
        watcherState.processedSignatures.delete(knownPath);
      }
    }

    const destinationDir = resolveDestinationDir(
      config.outputMode,
      config.outputDir
    );
    const destinationKey = destinationDir.toLowerCase();
    const outputFormatKey = normalizeOutputFormat(config.outputFormat);

    for (const file of keyFiles) {
      const signature = `${file.size}|${Math.floor(
        file.mtimeMs
      )}|${destinationKey}|${outputFormatKey}`;
      const previous = watcherState.processedSignatures.get(file.fullPath);
      if (previous === signature) {
        continue;
      }

      try {
        const result = await convertEncryptedVideo(
          file.fullPath,
          destinationDir,
          outputFormatKey
        );
        watcherState.processedSignatures.set(file.fullPath, signature);
        pushHistory({
          type: "watch-fix",
          status: "success",
          message: result.skipped
            ? `Already fixed: ${file.name}`
            : `Fixed: ${file.name}`,
          inputPath: file.fullPath,
          outputPath: result.outputPath,
          trigger,
          skipped: result.skipped,
        });
      } catch (error) {
        pushHistory({
          type: "watch-fix",
          status: "error",
          message: `Failed to fix ${file.name}: ${error.message}`,
          inputPath: file.fullPath,
          trigger,
        });
      }
    }

    watcherState.lastScanAt = new Date().toISOString();
  } finally {
    watcherState.isScanning = false;
  }
}

function startWatcher() {
  if (watcherState.running) {
    return false;
  }

  watcherState.running = true;
  watcherState.timer = setInterval(() => {
    runWatcherScan("interval").catch((error) => {
      pushHistory({
        type: "watch-scan",
        status: "error",
        message: `Watcher scan crashed: ${error.message}`,
      });
    });
  }, Math.max(2, config.pollSeconds) * 1000);

  pushHistory({
    type: "watcher",
    status: "info",
    message: `Watcher started. Poll=${config.pollSeconds}s`,
  });

  runWatcherScan("start").catch((error) => {
    pushHistory({
      type: "watch-scan",
      status: "error",
      message: `Initial watcher scan failed: ${error.message}`,
    });
  });
  return true;
}

function stopWatcher() {
  if (!watcherState.running) {
    return false;
  }

  if (watcherState.timer) {
    clearInterval(watcherState.timer);
  }
  watcherState.timer = null;
  watcherState.running = false;

  pushHistory({
    type: "watcher",
    status: "info",
    message: "Watcher stopped.",
  });
  return true;
}

function restartWatcherIfRunning() {
  if (!watcherState.running) {
    return;
  }
  stopWatcher();
  startWatcher();
}

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    config,
    supportedOutputFormats: Object.keys(outputFormatProfiles),
    watcher: {
      running: watcherState.running,
      isScanning: watcherState.isScanning,
      lastScanAt: watcherState.lastScanAt,
    },
    legacy: {
      startupCmdExists: fs.existsSync(legacyStartupCmd),
    },
    history: history.slice(-150).reverse(),
  });
});

app.get("/api/discover-sources", (req, res) => {
  const sources = discoverSourceDirsQuick();
  res.json({
    ok: true,
    sources,
  });
});

app.post("/api/pick-folder", async (req, res) => {
  try {
    const body = req.body || {};
    const initialPath = normalizeAbsoluteDir(body.initialPath || "");
    const selectedPath = await pickFolderDialog(initialPath);
    res.json({
      ok: true,
      selectedPath,
      cancelled: !selectedPath,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/legacy-status", async (req, res) => {
  try {
    const status = await getLegacyAutomationStatus();
    res.json({
      ok: true,
      ...status,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/legacy-disable", async (req, res) => {
  try {
    const result = await disableLegacyAutomation();
    pushHistory({
      type: "legacy-automation",
      status: "info",
      message: `Legacy automation disabled. StartupRemoved=${result.removedStartup} Stopped=${result.stoppedCount}`,
    });
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/files", async (req, res) => {
  try {
    const fromQuery = normalizeAbsoluteDir(req.query.sourceDir);
    const sourceDir = fromQuery || config.sourceDir;
    const includeNonKeyFiles =
      req.query.includeNonKeyFiles === undefined
        ? config.includeNonKeyFiles
        : isTruthy(req.query.includeNonKeyFiles);

    if (!sourceDir || !fs.existsSync(sourceDir)) {
      return res.json({
        ok: true,
        sourceDir: sourceDir || "",
        count: 0,
        grouped: {
          today: [],
          yesterday: [],
          earlier: [],
        },
        files: [],
      });
    }

    const allFiles = await listFilesRecursive(sourceDir);
    const filtered = includeNonKeyFiles
      ? allFiles
      : allFiles.filter((file) => file.isFixable);

    const grouped = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    for (const file of filtered) {
      grouped[file.group].push(file);
    }

    return res.json({
      ok: true,
      sourceDir,
      count: filtered.length,
      grouped,
      files: filtered,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    const body = req.body || {};
    const next = { ...config };

    if (Object.prototype.hasOwnProperty.call(body, "sourceDir")) {
      const raw = String(body.sourceDir || "").trim();
      if (!raw) {
        next.sourceDir = "";
      } else if (!path.isAbsolute(raw)) {
        return res.status(400).json({
          ok: false,
          error: "sourceDir must be an absolute path.",
        });
      } else {
        next.sourceDir = path.normalize(raw);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "outputMode")) {
      next.outputMode = body.outputMode === "custom" ? "custom" : "downloads";
    }

    if (Object.prototype.hasOwnProperty.call(body, "outputFormat")) {
      next.outputFormat = normalizeOutputFormat(body.outputFormat);
    }

    if (Object.prototype.hasOwnProperty.call(body, "outputDir")) {
      const raw = String(body.outputDir || "").trim();
      if (!raw) {
        next.outputDir = defaultConfig.outputDir;
      } else if (!path.isAbsolute(raw)) {
        return res.status(400).json({
          ok: false,
          error: "outputDir must be an absolute path.",
        });
      } else {
        next.outputDir = path.normalize(raw);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "pollSeconds")) {
      const parsed = Number.parseInt(String(body.pollSeconds), 10);
      if (!Number.isFinite(parsed)) {
        return res.status(400).json({
          ok: false,
          error: "pollSeconds must be a number.",
        });
      }
      next.pollSeconds = parsed;
    }

    if (Object.prototype.hasOwnProperty.call(body, "autoStartWatcher")) {
      next.autoStartWatcher = Boolean(body.autoStartWatcher);
    }

    if (Object.prototype.hasOwnProperty.call(body, "includeNonKeyFiles")) {
      next.includeNonKeyFiles = Boolean(body.includeNonKeyFiles);
    }

    if (next.outputMode === "custom" && !normalizeAbsoluteDir(next.outputDir)) {
      return res.status(400).json({
        ok: false,
        error: "Custom output mode requires a valid absolute output folder.",
      });
    }

    const sanitized = sanitizeConfig(next);
    if (sanitized.outputMode === "custom" && !sanitized.outputDir) {
      return res.status(400).json({
        ok: false,
        error: "Custom output mode requires outputDir.",
      });
    }

    config = sanitized;
    saveConfig(config);
    restartWatcherIfRunning();

    pushHistory({
      type: "settings",
      status: "success",
      message: "Settings updated.",
    });

    return res.json({
      ok: true,
      config,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/check-output", async (req, res) => {
  try {
    const body = req.body || {};
    const inputPath = normalizeAbsoluteFile(body.inputPath);
    if (!inputPath) {
      return res.status(400).json({
        ok: false,
        error: "inputPath must be an absolute file path.",
      });
    }

    const destinationMode =
      body.destinationMode === "custom" || body.destinationMode === "downloads"
        ? body.destinationMode
        : config.outputMode;
    const destinationDir = resolveDestinationDir(
      destinationMode,
      body.destinationDir || config.outputDir
    );
    const outputFormat = normalizeOutputFormat(body.outputFormat || config.outputFormat);
    const target = resolveOutputTarget(inputPath, destinationDir, outputFormat);

    let inputStat = null;
    let outputStat = null;

    try {
      inputStat = await fsp.stat(target.source);
    } catch {
      return res.status(400).json({
        ok: false,
        error: "Input file does not exist.",
      });
    }

    try {
      outputStat = await fsp.stat(target.outputPath);
    } catch {
      outputStat = null;
    }

    const exists = Boolean(outputStat && outputStat.isFile() && outputStat.size > 0);
    const skipLikely = Boolean(
      exists && inputStat && outputStat.mtimeMs >= inputStat.mtimeMs
    );

    return res.json({
      ok: true,
      exists,
      skipLikely,
      outputPath: target.outputPath,
      destinationDir,
      outputFormat: target.formatKey,
      outputMtimeIso: outputStat ? new Date(outputStat.mtimeMs).toISOString() : "",
      outputSize: outputStat ? outputStat.size : 0,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/open-path", async (req, res) => {
  try {
    const body = req.body || {};
    const action = String(body.action || "").trim().toLowerCase();
    const targetPath = String(body.targetPath || "").trim();
    if (!targetPath) {
      return res.status(400).json({
        ok: false,
        error: "targetPath is required.",
      });
    }

    await openPathInExplorer(action, targetPath);
    return res.json({
      ok: true,
      action,
      targetPath,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/fix", async (req, res) => {
  try {
    const body = req.body || {};
    const inputPath = normalizeAbsoluteFile(body.inputPath);
    if (!inputPath) {
      return res.status(400).json({
        ok: false,
        error: "inputPath must be an absolute file path.",
      });
    }

    const destinationMode =
      body.destinationMode === "custom" || body.destinationMode === "downloads"
        ? body.destinationMode
        : config.outputMode;
    const destinationDir = resolveDestinationDir(
      destinationMode,
      body.destinationDir || config.outputDir
    );
    const outputFormat = normalizeOutputFormat(body.outputFormat || config.outputFormat);

    const result = await convertEncryptedVideo(inputPath, destinationDir, outputFormat);
    pushHistory({
      type: "manual-fix",
      status: "success",
      message: result.skipped
        ? `Already fixed: ${path.basename(inputPath)}`
        : `Fixed: ${path.basename(inputPath)}`,
      inputPath,
      outputPath: result.outputPath,
      skipped: result.skipped,
      outputFormat: result.outputFormat,
    });

    return res.json({
      ok: true,
      destinationDir,
      ...result,
    });
  } catch (error) {
    pushHistory({
      type: "manual-fix",
      status: "error",
      message: error.message,
    });
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/fix-batch", async (req, res) => {
  const body = req.body || {};
  const inputPaths = Array.isArray(body.inputPaths) ? body.inputPaths : [];

  if (inputPaths.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "inputPaths must be a non-empty array.",
    });
  }
  if (inputPaths.length > 500) {
    return res.status(400).json({
      ok: false,
      error: "Too many files in one request (max 500).",
    });
  }

  let destinationDir = "";
  let outputFormat = normalizeOutputFormat(config.outputFormat);
  try {
    const destinationMode =
      body.destinationMode === "custom" || body.destinationMode === "downloads"
        ? body.destinationMode
        : config.outputMode;
    destinationDir = resolveDestinationDir(
      destinationMode,
      body.destinationDir || config.outputDir
    );
    outputFormat = normalizeOutputFormat(body.outputFormat || config.outputFormat);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
    });
  }

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const rawPath of inputPaths) {
    const inputPath = normalizeAbsoluteFile(rawPath);
    if (!inputPath) {
      failCount += 1;
      results.push({
        inputPath: String(rawPath || ""),
        ok: false,
        error: "Path must be absolute.",
      });
      continue;
    }

    try {
      const result = await convertEncryptedVideo(inputPath, destinationDir, outputFormat);
      successCount += 1;
      results.push({
        inputPath,
        ok: true,
        outputPath: result.outputPath,
        skipped: result.skipped,
        outputFormat: result.outputFormat,
      });
      pushHistory({
        type: "manual-fix-batch",
        status: "success",
        message: result.skipped
          ? `Already fixed: ${path.basename(inputPath)}`
          : `Fixed: ${path.basename(inputPath)}`,
        inputPath,
        outputPath: result.outputPath,
        outputFormat: result.outputFormat,
      });
    } catch (error) {
      failCount += 1;
      results.push({
        inputPath,
        ok: false,
        error: error.message,
      });
      pushHistory({
        type: "manual-fix-batch",
        status: "error",
        message: `Failed: ${path.basename(inputPath)} - ${error.message}`,
        inputPath,
      });
    }
  }

  return res.json({
    ok: true,
    destinationDir,
    outputFormat,
    successCount,
    failCount,
    results,
  });
});

app.post("/api/watcher/start", (req, res) => {
  const started = startWatcher();
  res.json({
    ok: true,
    started,
    watcher: {
      running: watcherState.running,
      isScanning: watcherState.isScanning,
      lastScanAt: watcherState.lastScanAt,
    },
  });
});

app.post("/api/watcher/stop", (req, res) => {
  const stopped = stopWatcher();
  res.json({
    ok: true,
    stopped,
    watcher: {
      running: watcherState.running,
      isScanning: watcherState.isScanning,
      lastScanAt: watcherState.lastScanAt,
    },
  });
});

app.post("/api/watcher/scan", async (req, res) => {
  try {
    await runWatcherScan("manual-request");
    res.json({
      ok: true,
      watcher: {
        running: watcherState.running,
        isScanning: watcherState.isScanning,
        lastScanAt: watcherState.lastScanAt,
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

config = loadConfig();

const port = Number.parseInt(process.env.PORT || "3210", 10) || 3210;
app.listen(port, () => {
  const source = config.sourceDir || "(not configured)";
  const destination =
    config.outputMode === "custom" ? config.outputDir : defaultConfig.outputDir;
  const format = normalizeOutputFormat(config.outputFormat);
  console.log(`FonePaw web app running at http://localhost:${port}`);
  console.log(`Source: ${source}`);
  console.log(`Destination: ${destination}`);
  console.log(`Output format: ${format}`);
  writeLog(
    `Server started on port ${port}. Source=${source} Destination=${destination} Format=${format}`
  );

  if (config.autoStartWatcher) {
    startWatcher();
  }
});

process.on("SIGINT", () => {
  stopWatcher();
  process.exit(0);
});
