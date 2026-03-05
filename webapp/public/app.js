const GROUP_PAGE_SIZE = 14;
const RUNTIME_LAUNCHER_PS1_URL =
  "https://raw.githubusercontent.com/gerd03/fnpw/main/webapp/public/desktop/Start-FonePawDesktopRuntime.ps1";
const RUNTIME_ONE_LINER = `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing '${RUNTIME_LAUNCHER_PS1_URL}' | iex"`;
const DESKTOP_API_BASE_CANDIDATES = ["", "http://127.0.0.1:3210", "http://localhost:3210"];
const CLIENT_DEFAULT_CONFIG = {
  sourceDir: "",
  outputMode: "downloads",
  outputFormat: "mp4",
  outputDir: "",
  pollSeconds: 5,
  autoStartWatcher: false,
};

const state = {
  config: null,
  files: [],
  grouped: { today: [], yesterday: [], earlier: [] },
  supportedOutputFormats: ["mp4", "mov", "mkv", "wmv", "webm", "f4v", "mpegts", "gif"],
  cloudQueue: [],
  cloudNextId: 1,
  ui: {
    settingsDirty: false,
    manualDestinationTouched: false,
    theme: "dark",
    modalResolver: null,
    loadingFiles: false,
    cloudPreview: false,
    localRuntimeAvailable: false,
    localApiBase: "",
    currentMode: "desktop",
    groupRenderCount: {
      today: GROUP_PAGE_SIZE,
      yesterday: GROUP_PAGE_SIZE,
      earlier: GROUP_PAGE_SIZE,
    },
    revealObserver: null,
  },
};

const els = {
  themeToggle: document.getElementById("themeToggle"),
  modeDesktopBtn: document.getElementById("modeDesktopBtn"),
  modeCloudBtn: document.getElementById("modeCloudBtn"),
  modeHint: document.getElementById("modeHint"),
  runtimeDownloadBtn: document.getElementById("runtimeDownloadBtn"),
  runtimeCopyCmdBtn: document.getElementById("runtimeCopyCmdBtn"),
  runtimeConnectBtn: document.getElementById("runtimeConnectBtn"),
  runtimeOpenLocalBtn: document.getElementById("runtimeOpenLocalBtn"),
  runtimeHint: document.getElementById("runtimeHint"),
  workspaceGrid: document.getElementById("workspaceGrid"),
  cloudStudio: document.getElementById("cloudStudio"),
  sourceDir: document.getElementById("sourceDir"),
  sourceBrowseBtn: document.getElementById("sourceBrowseBtn"),
  discoverBtn: document.getElementById("discoverBtn"),
  sourceSelect: document.getElementById("sourceSelect"),
  outputMode: document.getElementById("outputMode"),
  outputFormat: document.getElementById("outputFormat"),
  outputDir: document.getElementById("outputDir"),
  outputBrowseBtn: document.getElementById("outputBrowseBtn"),
  pollSeconds: document.getElementById("pollSeconds"),
  autoStartWatcher: document.getElementById("autoStartWatcher"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  settingsStatus: document.getElementById("settingsStatus"),
  manualDestinationMode: document.getElementById("manualDestinationMode"),
  manualOutputFormat: document.getElementById("manualOutputFormat"),
  manualDestinationDir: document.getElementById("manualDestinationDir"),
  manualDestinationBrowseBtn: document.getElementById("manualDestinationBrowseBtn"),
  refreshFilesBtn: document.getElementById("refreshFilesBtn"),
  fixSelectedBtn: document.getElementById("fixSelectedBtn"),
  selectAll: document.getElementById("selectAll"),
  fileSearch: document.getElementById("fileSearch"),
  fileGroups: document.getElementById("fileGroups"),
  fileCount: document.getElementById("fileCount"),
  fileLoading: document.getElementById("fileLoading"),
  toastStack: document.getElementById("toastStack"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  modalTitle: document.getElementById("modalTitle"),
  modalMessage: document.getElementById("modalMessage"),
  modalSecondaryBtn: document.getElementById("modalSecondaryBtn"),
  modalCancelBtn: document.getElementById("modalCancelBtn"),
  modalConfirmBtn: document.getElementById("modalConfirmBtn"),
  cloudFileInput: document.getElementById("cloudFileInput"),
  cloudPickBtn: document.getElementById("cloudPickBtn"),
  cloudFixSelectedBtn: document.getElementById("cloudFixSelectedBtn"),
  cloudClearBtn: document.getElementById("cloudClearBtn"),
  cloudAutoDownload: document.getElementById("cloudAutoDownload"),
  cloudQueueBody: document.getElementById("cloudQueueBody"),
  cloudCount: document.getElementById("cloudCount"),
};

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function displayFileName(input) {
  const name = String(input || "");
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) {
    return name;
  }
  return name.slice(0, lastDot);
}

function fileNameFromPath(filePath) {
  const raw = String(filePath || "");
  const parts = raw.split(/[/\\]+/);
  return parts[parts.length - 1] || raw;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function formatDate(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function normalizeOutputFormat(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "mpeg-ts" || raw === "mpeg_ts" || raw === "ts") {
    return "mpegts";
  }
  if (state.supportedOutputFormats.includes(raw)) {
    return raw;
  }
  return "mp4";
}

function outputFormatLabel(value) {
  const normalized = normalizeOutputFormat(value);
  if (normalized === "mpegts") return "MPEG-TS";
  if (normalized === "webm") return "WebM";
  return normalized.toUpperCase();
}

function setSelectSafeValue(selectEl, value, fallbackValue) {
  if (!selectEl) return;
  const next = String(value || "");
  const exists = [...selectEl.options].some((option) => option.value === next);
  selectEl.value = exists ? next : fallbackValue;
}

function upsertFormatOptions(selectEl, formats, options = {}) {
  if (!selectEl) return;
  const includeCore = Boolean(options.includeCore);
  const previous = String(selectEl.value || "");

  selectEl.innerHTML = "";
  if (includeCore) {
    const core = document.createElement("option");
    core.value = "core";
    core.textContent = "Use Core Setting";
    selectEl.appendChild(core);
  }

  for (const format of formats) {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = outputFormatLabel(format);
    selectEl.appendChild(option);
  }

  const fallback = includeCore ? "core" : "mp4";
  setSelectSafeValue(selectEl, previous || fallback, fallback);
}

function syncFormatSelects() {
  const unique = [...new Set(state.supportedOutputFormats.map(normalizeOutputFormat))];
  state.supportedOutputFormats = unique.length > 0 ? unique : ["mp4"];
  upsertFormatOptions(els.outputFormat, state.supportedOutputFormats, { includeCore: false });
  upsertFormatOptions(els.manualOutputFormat, state.supportedOutputFormats, {
    includeCore: true,
  });
}

function showToast(message, type = "info", durationMs = 3400) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, durationMs);
}

function setStatusText(text, isError = false) {
  els.settingsStatus.textContent = text;
  els.settingsStatus.style.color = isError ? "var(--danger-ink)" : "var(--muted)";
}

function setBusy(button, busy) {
  button.disabled = Boolean(busy);
}

function setFilesLoading(loading) {
  state.ui.loadingFiles = Boolean(loading);
  if (els.fileLoading) {
    els.fileLoading.classList.toggle("hidden", !state.ui.loadingFiles);
  }
}

function getDesktopControls() {
  return [
    els.sourceDir,
    els.sourceBrowseBtn,
    els.discoverBtn,
    els.sourceSelect,
    els.outputMode,
    els.outputFormat,
    els.outputDir,
    els.outputBrowseBtn,
    els.pollSeconds,
    els.autoStartWatcher,
    els.saveSettingsBtn,
    els.manualDestinationMode,
    els.manualOutputFormat,
    els.manualDestinationDir,
    els.manualDestinationBrowseBtn,
    els.refreshFilesBtn,
    els.fixSelectedBtn,
    els.selectAll,
    els.fileSearch,
  ];
}

function setDesktopControlsDisabled(disabled) {
  for (const control of getDesktopControls()) {
    if (control) {
      control.disabled = Boolean(disabled);
    }
  }
}

function updateModeButtons() {
  const desktop = state.ui.currentMode === "desktop";
  els.modeDesktopBtn?.classList.toggle("active", desktop);
  els.modeCloudBtn?.classList.toggle("active", !desktop);
  if (els.modeDesktopBtn) {
    els.modeDesktopBtn.setAttribute("aria-pressed", desktop ? "true" : "false");
  }
  if (els.modeCloudBtn) {
    els.modeCloudBtn.setAttribute("aria-pressed", desktop ? "false" : "true");
  }
}

function setModeHint(text) {
  if (els.modeHint) {
    els.modeHint.textContent = text;
  }
}

function setRuntimeHint(text, isError = false) {
  if (!els.runtimeHint) return;
  els.runtimeHint.textContent = text;
  els.runtimeHint.style.color = isError ? "var(--danger-ink)" : "var(--muted)";
}

function normalizeApiBase(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

function buildApiUrl(pathname) {
  const path = String(pathname || "");
  const base = normalizeApiBase(state.ui.localApiBase);
  return base ? `${base}${path}` : path;
}

async function probeDesktopRuntime(baseUrl) {
  const apiBase = normalizeApiBase(baseUrl);
  const url = apiBase ? `${apiBase}/api/status` : "/api/status";
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return { ok: false, apiBase, reason: `HTTP ${response.status}` };
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return { ok: false, apiBase, reason: "Non-JSON response" };
  }

  const payload = await response.json();
  if (!payload || payload.ok !== true || !payload.config) {
    return { ok: false, apiBase, reason: "Invalid runtime payload" };
  }

  return { ok: true, apiBase, payload };
}

async function detectDesktopRuntime() {
  for (const candidate of DESKTOP_API_BASE_CANDIDATES) {
    try {
      const result = await probeDesktopRuntime(candidate);
      if (result.ok) {
        return result;
      }
    } catch {
      // Continue probing other candidates.
    }
  }
  return { ok: false, apiBase: "", payload: null };
}

function setAppMode(mode) {
  const nextMode = mode === "cloud" ? "cloud" : "desktop";
  state.ui.currentMode = nextMode;
  const desktop = nextMode === "desktop";

  els.workspaceGrid?.classList.toggle("hidden", !desktop);
  els.cloudStudio?.classList.toggle("hidden", desktop);
  document.body.classList.toggle("cloud-mode", !desktop);

  if (desktop) {
    if (state.ui.localRuntimeAvailable) {
      setModeHint("Desktop mode active: local folders, auto watch, and full device tools.");
      setRuntimeHint(
        state.ui.localApiBase
          ? `Runtime connected at ${state.ui.localApiBase}.`
          : "Runtime connected on current host.",
        false
      );
    } else {
      setModeHint(
        "Desktop mode requires local runtime. Switch to Cloud Mode to upload and fix files globally."
      );
      setRuntimeHint(
        "Run launcher first, then click Connect Runtime.",
        false
      );
    }
  } else {
    if (state.ui.localRuntimeAvailable) {
      setModeHint("Cloud mode active: optional browser upload fixer and instant downloads.");
      setRuntimeHint(
        state.ui.localApiBase
          ? `Desktop runtime is still connected at ${state.ui.localApiBase}.`
          : "Desktop runtime is connected.",
        false
      );
    } else {
      setModeHint("Cloud mode active: upload encrypted files and download fixed exports.");
      setRuntimeHint(
        "You can still enable desktop runtime anytime using Quick Start.",
        false
      );
    }
  }

  updateModeButtons();
}

function encryptedOutputExtensionForFileName(fileName) {
  const raw = String(fileName || "");
  const dotIndex = raw.lastIndexOf(".");
  if (dotIndex < 0) return ".mp4";

  const ext = raw.slice(dotIndex + 1).toLowerCase();
  if (!ext.startsWith("key")) {
    return `.${ext || "mp4"}`;
  }

  const decoded = ext.slice(3);
  if (!decoded) return ".mp4";
  if (decoded === "mpegts" || decoded === "mpeg-ts" || decoded === "ts") return ".ts";
  return `.${decoded}`;
}

function deriveCloudOutputName(fileName) {
  const raw = String(fileName || "").trim() || "output";
  const dotIndex = raw.lastIndexOf(".");
  const baseName = dotIndex > 0 ? raw.slice(0, dotIndex) : raw;
  const outExt = encryptedOutputExtensionForFileName(raw);
  return `${baseName}${outExt}`;
}

function mimeTypeForExtension(ext) {
  const key = String(ext || "").toLowerCase();
  switch (key) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".wmv":
      return "video/x-ms-wmv";
    case ".webm":
      return "video/webm";
    case ".f4v":
      return "video/x-f4v";
    case ".ts":
      return "video/mp2t";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function isCloudFixableFile(file) {
  if (!file || !file.name) return false;
  const dotIndex = file.name.lastIndexOf(".");
  if (dotIndex < 0) return false;
  const ext = file.name.slice(dotIndex + 1).toLowerCase();
  return ext.startsWith("key");
}

function clearCloudObjectUrls() {
  for (const item of state.cloudQueue) {
    if (item.blobUrl) {
      URL.revokeObjectURL(item.blobUrl);
      item.blobUrl = "";
    }
  }
}

function cloudStatusLabel(item) {
  if (item.status === "ready") return "Ready";
  if (item.status === "processing") return "Processing...";
  if (item.status === "error") return "Failed";
  return "Queued";
}

function renderCloudQueue() {
  const total = state.cloudQueue.length;
  if (els.cloudCount) {
    els.cloudCount.textContent = `${total} file(s)`;
  }
  if (!els.cloudQueueBody) return;

  if (total === 0) {
    els.cloudQueueBody.innerHTML = `
      <tr>
        <td colspan="6" class="status-label">No uploaded files yet.</td>
      </tr>
    `;
    return;
  }

  els.cloudQueueBody.innerHTML = state.cloudQueue
    .map((item) => {
      const statusClass = item.status === "error" ? "cloud-error" : item.status === "ready" ? "cloud-ready" : "";
      const disabledFix = item.status === "processing" ? "disabled" : "";
      const disabledDownload = item.status === "ready" ? "" : "disabled";
      return `
        <tr>
          <td>
            <input
              type="checkbox"
              class="file-check cloud-check"
              data-id="${item.id}"
              ${item.selected ? "checked" : ""}
              ${item.status === "processing" ? "disabled" : ""}
            />
          </td>
          <td><strong title="${escapeHtml(item.file.name)}">${escapeHtml(displayFileName(item.file.name))}</strong></td>
          <td>${formatBytes(item.file.size)}</td>
          <td title="${escapeHtml(item.outputName)}">${escapeHtml(item.outputName)}</td>
          <td class="${statusClass}">${escapeHtml(cloudStatusLabel(item))}</td>
          <td>
            <div class="cloud-row-actions">
              <button type="button" class="btn ghost cloud-fix-one" data-id="${item.id}" ${disabledFix}>Fix</button>
              <button type="button" class="btn ghost cloud-download-one" data-id="${item.id}" ${disabledDownload}>Download</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function queueCloudFiles(fileList) {
  const incoming = [...(fileList || [])];
  if (incoming.length === 0) return;

  const existingKeys = new Set(
    state.cloudQueue.map((item) => `${item.file.name}|${item.file.size}|${item.file.lastModified}`)
  );

  let added = 0;
  let ignored = 0;
  for (const file of incoming) {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (existingKeys.has(key) || !isCloudFixableFile(file)) {
      ignored += 1;
      continue;
    }
    existingKeys.add(key);
    state.cloudQueue.push({
      id: state.cloudNextId++,
      file,
      outputExt: encryptedOutputExtensionForFileName(file.name),
      outputName: deriveCloudOutputName(file.name),
      status: "queued",
      selected: true,
      outputBlob: null,
      blobUrl: "",
      error: "",
    });
    added += 1;
  }

  renderCloudQueue();
  if (added > 0) {
    showToast(`Uploaded ${added} file(s) to cloud queue.`, "success");
  }
  if (ignored > 0) {
    showToast(`${ignored} file(s) were skipped (duplicate or unsupported).`, "info", 4600);
  }
}

async function decodeCloudItemToBlob(item) {
  const buffer = await item.file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const headerLen = Math.min(48, bytes.length);
  for (let i = 0; i < headerLen; i += 1) {
    bytes[i] = bytes[i] ^ 0xcd;
  }
  return new Blob([bytes], { type: mimeTypeForExtension(item.outputExt) });
}

function ensureCloudBlobUrl(item) {
  if (!item.outputBlob) {
    throw new Error("File is not fixed yet.");
  }
  if (!item.blobUrl) {
    item.blobUrl = URL.createObjectURL(item.outputBlob);
  }
  return item.blobUrl;
}

function triggerBrowserDownload(blobUrl, fileName) {
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function saveBlobWithPicker(blob, fileName) {
  if (typeof window.showSaveFilePicker !== "function") {
    return false;
  }

  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : ".mp4";
  const handle = await window.showSaveFilePicker({
    suggestedName: fileName,
    types: [
      {
        description: "Video Export",
        accept: {
          [mimeTypeForExtension(extension)]: [extension],
        },
      },
    ],
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

function getCloudSelectedIds() {
  return state.cloudQueue.filter((item) => item.selected).map((item) => item.id);
}

function getCloudItemById(id) {
  return state.cloudQueue.find((item) => item.id === id) || null;
}

async function handleCloudSuccessAction(item) {
  const autoDownload = Boolean(els.cloudAutoDownload?.checked);
  if (autoDownload) {
    triggerBrowserDownload(ensureCloudBlobUrl(item), item.outputName);
    showToast(`Downloaded ${displayFileName(item.outputName)}.`, "success");
    return;
  }

  const action = await openModal({
    title: "Export Successful",
    message: `${displayFileName(item.outputName)} is ready. Choose what you want to do next.`,
    confirmText: "Download",
    secondaryText: "Save As",
    cancelText: "Later",
    hideSecondary: false,
  });

  if (action === "confirm") {
    triggerBrowserDownload(ensureCloudBlobUrl(item), item.outputName);
    return;
  }
  if (action === "secondary") {
    try {
      const saved = await saveBlobWithPicker(item.outputBlob, item.outputName);
      if (saved) {
        showToast(`Saved ${displayFileName(item.outputName)}.`, "success");
        return;
      }
    } catch (error) {
      if (error && error.name !== "AbortError") {
        showToast(error.message || "Save As failed. Falling back to download.", "error", 5200);
      }
    }
    triggerBrowserDownload(ensureCloudBlobUrl(item), item.outputName);
  }
}

async function fixCloudItemById(id, options = {}) {
  const showSuccessModal = options.showSuccessModal !== false;
  const item = getCloudItemById(id);
  if (!item || item.status === "processing") return false;

  const existingReady = state.cloudQueue.find(
    (other) =>
      other.id !== item.id &&
      other.status === "ready" &&
      other.outputName.toLowerCase() === item.outputName.toLowerCase()
  );

  if (existingReady) {
    const duplicateAction = await openModal({
      title: "Output Already Exists",
      message:
        "This output name is already fixed in your queue. Download existing file or continue re-fixing.",
      confirmText: "Fix Anyway",
      secondaryText: "Download Existing",
      cancelText: "Cancel",
      hideSecondary: false,
      tone: "danger",
    });
    if (duplicateAction === "secondary") {
      triggerBrowserDownload(ensureCloudBlobUrl(existingReady), existingReady.outputName);
      return false;
    }
    if (duplicateAction !== "confirm") {
      return false;
    }
  }

  item.status = "processing";
  item.error = "";
  renderCloudQueue();

  try {
    item.outputBlob = await decodeCloudItemToBlob(item);
    if (item.blobUrl) {
      URL.revokeObjectURL(item.blobUrl);
      item.blobUrl = "";
    }
    item.status = "ready";
    renderCloudQueue();

    if (showSuccessModal) {
      await handleCloudSuccessAction(item);
    }
    return true;
  } catch (error) {
    item.status = "error";
    item.error = error.message;
    renderCloudQueue();
    showToast(`Fix failed for ${item.file.name}: ${error.message}`, "error", 5200);
    return false;
  }
}

async function fixSelectedCloudFiles() {
  const ids = getCloudSelectedIds();
  if (ids.length === 0) {
    await alertDialog("No File Selected", "Select at least one uploaded file to fix.");
    return;
  }

  const accepted = await confirmDialog(
    "Fix Selected Files",
    `Fix ${ids.length} selected cloud file(s) now?`,
    { confirmText: "Fix Selected" }
  );
  if (!accepted) return;

  let successCount = 0;
  for (const id of ids) {
    const ok = await fixCloudItemById(id, { showSuccessModal: false });
    if (ok) successCount += 1;
  }

  showToast(`Cloud fix completed. Success: ${successCount}/${ids.length}.`, "success", 4200);

  const readyItems = state.cloudQueue.filter((item) => item.status === "ready");
  if (readyItems.length === 0) return;

  const action = await openModal({
    title: "Cloud Export Complete",
    message: "Your selected files were fixed. Download all now or save the first file manually.",
    confirmText: "Download All",
    secondaryText: "Save First As",
    cancelText: "Close",
    hideSecondary: false,
  });

  if (action === "confirm") {
    for (const item of readyItems) {
      triggerBrowserDownload(ensureCloudBlobUrl(item), item.outputName);
    }
    return;
  }
  if (action === "secondary") {
    try {
      const first = readyItems[0];
      const saved = await saveBlobWithPicker(first.outputBlob, first.outputName);
      if (!saved) {
        triggerBrowserDownload(ensureCloudBlobUrl(first), first.outputName);
      }
    } catch (error) {
      if (error && error.name !== "AbortError") {
        showToast(error.message || "Save As failed. Downloading first file.", "error", 5200);
      }
      triggerBrowserDownload(ensureCloudBlobUrl(readyItems[0]), readyItems[0].outputName);
    }
  }
}

function wireCloudActions() {
  if (!els.cloudPickBtn) return;

  els.cloudPickBtn.addEventListener("click", () => {
    els.cloudFileInput?.click();
  });

  els.cloudFileInput?.addEventListener("change", (event) => {
    queueCloudFiles(event.target.files);
    event.target.value = "";
  });

  els.cloudClearBtn?.addEventListener("click", async () => {
    if (state.cloudQueue.length === 0) return;
    const accepted = await confirmDialog(
      "Clear Cloud Queue",
      "Remove all uploaded and fixed items from queue?",
      { confirmText: "Clear Queue", tone: "danger" }
    );
    if (!accepted) return;
    clearCloudObjectUrls();
    state.cloudQueue = [];
    renderCloudQueue();
  });

  els.cloudFixSelectedBtn?.addEventListener("click", async () => {
    setBusy(els.cloudFixSelectedBtn, true);
    try {
      await fixSelectedCloudFiles();
    } catch (error) {
      showToast(error.message, "error", 5200);
    } finally {
      setBusy(els.cloudFixSelectedBtn, false);
    }
  });

  els.cloudQueueBody?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("cloud-check")) return;
    const id = Number.parseInt(String(target.dataset.id || ""), 10);
    const item = getCloudItemById(id);
    if (!item) return;
    item.selected = target.checked;
  });

  els.cloudQueueBody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = Number.parseInt(String(target.dataset.id || ""), 10);
    if (!Number.isFinite(id)) return;

    if (target.classList.contains("cloud-fix-one")) {
      setBusy(target, true);
      try {
        await fixCloudItemById(id);
      } catch (error) {
        showToast(error.message, "error", 5200);
      } finally {
        setBusy(target, false);
      }
      return;
    }

    if (target.classList.contains("cloud-download-one")) {
      const item = getCloudItemById(id);
      if (!item || item.status !== "ready") return;
      triggerBrowserDownload(ensureCloudBlobUrl(item), item.outputName);
    }
  });
}

function enableCloudPreviewMode() {
  state.ui.cloudPreview = true;
  state.ui.localRuntimeAvailable = false;
  state.ui.localApiBase = "";
  state.config = { ...CLIENT_DEFAULT_CONFIG };
  applyConfigToForm({ force: true });
  setDesktopControlsDisabled(true);
  state.files = [];
  state.grouped = { today: [], yesterday: [], earlier: [] };
  renderGroups();
  els.fileGroups.innerHTML = `
    <section class="file-empty reveal in-view">
      <h3>Desktop Runtime Unavailable</h3>
      <p>Use Cloud Mode for global browser-based fixing, or run local runtime for full desktop automation.</p>
    </section>
  `;
  els.fileCount.textContent = "0 visible / 0 total";
  setAppMode("desktop");
  setStatusText("Desktop runtime unavailable. Use Quick Start, then click Connect Runtime.");
  setRuntimeHint(
    "Step 1: Download launcher. Step 2: run it once. Step 3: click Connect Runtime.",
    false
  );
  renderCloudQueue();
}

async function api(url, options = {}) {
  if (!state.ui.localRuntimeAvailable) {
    throw new Error(
      "Desktop runtime is unavailable. Use Cloud Mode for upload-and-fix workflow."
    );
  }
  const response = await fetch(buildApiUrl(url), options);
  const json = await response.json();
  if (!response.ok || json.ok === false) {
    throw new Error(json.error || `Request failed: ${response.status}`);
  }
  return json;
}

async function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;

  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const temp = document.createElement("textarea");
  temp.value = value;
  temp.setAttribute("readonly", "true");
  temp.style.position = "fixed";
  temp.style.left = "-9999px";
  document.body.appendChild(temp);
  temp.select();
  const ok = document.execCommand("copy");
  temp.remove();
  return ok;
}

async function connectDesktopRuntime(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setRuntimeHint("Checking desktop runtime...", false);
  }

  const probe = await detectDesktopRuntime();
  if (!probe.ok) {
    enableCloudPreviewMode();
    if (!silent) {
      setRuntimeHint(
        "Runtime not detected. Run the launcher, wait for install, then click Connect Runtime again.",
        true
      );
      showToast("Desktop runtime is not running yet.", "error", 4800);
    }
    return false;
  }

  state.ui.localRuntimeAvailable = true;
  state.ui.localApiBase = probe.apiBase;
  state.ui.cloudPreview = false;
  setDesktopControlsDisabled(false);
  setAppMode("desktop");
  setRuntimeHint(
    probe.apiBase
      ? `Connected to local runtime at ${probe.apiBase}.`
      : "Connected to desktop runtime.",
    false
  );

  setStatusText("Desktop runtime connected.");
  await Promise.all([
    loadStatus({ syncForm: true, forceForm: true }),
    discoverSources(),
    loadFiles(),
  ]);

  if (!silent) {
    showToast("Desktop runtime connected successfully.", "success");
  }

  return true;
}

function getStoredTheme() {
  try {
    return window.localStorage.getItem("fonepaw_theme") || "";
  } catch {
    return "";
  }
}

function storeTheme(theme) {
  try {
    window.localStorage.setItem("fonepaw_theme", theme);
  } catch {
    // Ignore storage errors.
  }
}

function getSystemTheme() {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(themeName) {
  const theme = themeName === "light" ? "light" : "dark";
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(`theme-${theme}`);
  state.ui.theme = theme;
  if (els.themeToggle) {
    els.themeToggle.textContent =
      theme === "dark" ? "Switch to Light" : "Switch to Dark";
  }
  storeTheme(theme);
}

function initializeTheme() {
  const saved = getStoredTheme();
  const theme = saved === "light" || saved === "dark" ? saved : getSystemTheme();
  applyTheme(theme);
}

function openModal(options = {}) {
  const {
    title = "Confirm Action",
    message = "Are you sure?",
    confirmText = "Confirm",
    cancelText = "Cancel",
    hideCancel = false,
    secondaryText = "",
    hideSecondary = true,
    tone = "primary",
  } = options;

  els.modalTitle.textContent = title;
  els.modalMessage.textContent = message;
  els.modalConfirmBtn.textContent = confirmText;
  els.modalSecondaryBtn.textContent = secondaryText || "More";
  els.modalCancelBtn.textContent = cancelText;
  els.modalSecondaryBtn.classList.toggle(
    "hidden",
    hideSecondary || !String(secondaryText || "").trim()
  );
  els.modalCancelBtn.classList.toggle("hidden", hideCancel);

  els.modalConfirmBtn.classList.remove("primary", "danger", "ghost");
  if (tone === "danger") {
    els.modalConfirmBtn.classList.add("danger");
  } else if (tone === "ghost") {
    els.modalConfirmBtn.classList.add("ghost");
  } else {
    els.modalConfirmBtn.classList.add("primary");
  }

  els.modalBackdrop.classList.remove("hidden");
  els.modalBackdrop.setAttribute("aria-hidden", "false");
  els.modalBackdrop.classList.remove("modal-enter");
  void els.modalBackdrop.offsetWidth;
  els.modalBackdrop.classList.add("modal-enter");
  document.body.classList.add("modal-open");

  return new Promise((resolve) => {
    state.ui.modalResolver = resolve;
  });
}

function closeModal(result) {
  const resolver = state.ui.modalResolver;
  state.ui.modalResolver = null;
  els.modalBackdrop.classList.remove("modal-enter");
  els.modalBackdrop.classList.add("hidden");
  els.modalBackdrop.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  if (typeof resolver === "function") {
    resolver(result || "cancel");
  }
}

async function confirmDialog(title, message, options = {}) {
  const result = await openModal({
    title,
    message,
    confirmText: options.confirmText || "Confirm",
    cancelText: options.cancelText || "Cancel",
    tone: options.tone || "primary",
    hideCancel: false,
  });
  return result === "confirm";
}

async function alertDialog(title, message) {
  await openModal({
    title,
    message,
    confirmText: "OK",
    hideCancel: true,
    tone: "primary",
  });
}

function syncDestinationFieldStates() {
  const autoCustom = els.outputMode.value === "custom";
  els.outputDir.disabled = !autoCustom;
  els.outputBrowseBtn.disabled = !autoCustom;

  const manualCustom = els.manualDestinationMode.value === "custom";
  els.manualDestinationDir.disabled = !manualCustom;
  els.manualDestinationBrowseBtn.disabled = !manualCustom;
}

function markSettingsDirty() {
  if (!state.ui.settingsDirty) {
    setStatusText("Unsaved changes.");
  }
  state.ui.settingsDirty = true;
}

function resetGroupRenderCounts() {
  state.ui.groupRenderCount = {
    today: GROUP_PAGE_SIZE,
    yesterday: GROUP_PAGE_SIZE,
    earlier: GROUP_PAGE_SIZE,
  };
}

function applyConfigToForm(options = {}) {
  const force = Boolean(options.force);
  if (!state.config) return;
  if (!force && state.ui.settingsDirty) return;

  syncFormatSelects();

  els.sourceDir.value = state.config.sourceDir || "";
  els.outputMode.value = state.config.outputMode || "downloads";
  setSelectSafeValue(
    els.outputFormat,
    normalizeOutputFormat(state.config.outputFormat || "mp4"),
    "mp4"
  );
  els.outputDir.value = state.config.outputDir || "";
  els.pollSeconds.value = state.config.pollSeconds || 5;
  els.autoStartWatcher.checked = Boolean(state.config.autoStartWatcher);

  if (force || !state.ui.manualDestinationTouched) {
    els.manualDestinationMode.value = state.config.outputMode || "downloads";
    setSelectSafeValue(els.manualOutputFormat, "core", "core");
    els.manualDestinationDir.value = state.config.outputDir || "";
  }

  if (force) {
    state.ui.settingsDirty = false;
  }

  syncDestinationFieldStates();
}

function createFileRow(file) {
  const ext = String(file.ext || "").toLowerCase();
  const canFix = Boolean(file.isFixable || file.isKeyMp4 || ext.startsWith(".key"));
  const disabledAttr = canFix ? "" : "disabled";
  const encodedPath = encodeURIComponent(file.fullPath);
  const nameNoExt = displayFileName(file.name);

  return `
    <tr>
      <td><input type="checkbox" class="file-check" data-path="${encodedPath}" ${disabledAttr} /></td>
      <td><strong>${escapeHtml(nameNoExt)}</strong></td>
      <td>${formatBytes(file.size)}</td>
      <td>${formatDate(file.mtimeIso)}</td>
      <td>
        <button type="button" class="btn ghost fix-one" data-path="${encodedPath}" ${disabledAttr}>Fix</button>
      </td>
    </tr>
  `;
}

function renderSkeletonGroups() {
  els.fileGroups.innerHTML = `
    <section class="skeleton-block reveal">
      <div class="skeleton-line w-30"></div>
      <div class="skeleton-line w-85"></div>
      <div class="skeleton-line w-55"></div>
    </section>
    <section class="skeleton-block reveal">
      <div class="skeleton-line w-30"></div>
      <div class="skeleton-line w-85"></div>
      <div class="skeleton-line w-55"></div>
    </section>
  `;
  observeRevealNodes();
}

function renderGroups() {
  if (state.ui.loadingFiles) {
    renderSkeletonGroups();
    return;
  }

  const labels = {
    today: "Today",
    yesterday: "Yesterday",
    earlier: "Earlier",
  };

  const query = els.fileSearch.value.trim().toLowerCase();
  const filtered = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const key of Object.keys(filtered)) {
    const source = state.grouped[key] || [];
    filtered[key] = source.filter((file) => {
      if (!query) return true;
      return file.name.toLowerCase().includes(query);
    });
  }

  const keys = ["today", "yesterday", "earlier"];
  const sections = keys
    .map((key) => {
      const group = filtered[key] || [];
      if (group.length === 0) return "";

      const visibleCount = Math.min(group.length, state.ui.groupRenderCount[key] || GROUP_PAGE_SIZE);
      const visible = group.slice(0, visibleCount);
      const hasMore = group.length > visible.length;

      return `
        <section class="group-card reveal">
          <h3 class="group-head">
            <span>${labels[key]} (${group.length})</span>
          </h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Filename</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${visible.map(createFileRow).join("")}
              </tbody>
            </table>
          </div>
          ${
            hasMore
              ? `<div class="group-footer"><button type="button" class="load-more" data-group="${key}">Load More (${group.length - visible.length} left)</button></div>`
              : ""
          }
        </section>
      `;
    })
    .join("");

  const totalVisible = keys.reduce((sum, key) => sum + (filtered[key]?.length || 0), 0);
  els.fileCount.textContent = `${totalVisible} visible / ${state.files.length} total`;

  if (!sections) {
    els.fileGroups.innerHTML = `
      <section class="file-empty reveal">
        <h3>No matching files</h3>
        <p>Try another search term or refresh files.</p>
      </section>
    `;
  } else {
    els.fileGroups.innerHTML = sections;
  }

  wireRowActions();
  wireLoadMoreButtons();
  observeRevealNodes();
}

function observeRevealNodes() {
  const nodes = document.querySelectorAll(".reveal:not(.in-view)");
  if (nodes.length === 0) return;

  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("in-view"));
    return;
  }

  if (!state.ui.revealObserver) {
    state.ui.revealObserver = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.09 }
    );
  }

  nodes.forEach((node) => state.ui.revealObserver.observe(node));
}

async function pickFolder(initialPath = "") {
  const data = await api("/api/pick-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initialPath }),
  });
  return data.cancelled ? "" : data.selectedPath || "";
}

async function loadStatus(options = {}) {
  const syncForm = Boolean(options.syncForm);
  const forceForm = Boolean(options.forceForm);

  const data = await api("/api/status");
  state.config = data.config;

  if (Array.isArray(data.supportedOutputFormats) && data.supportedOutputFormats.length > 0) {
    state.supportedOutputFormats = data.supportedOutputFormats.map((item) =>
      normalizeOutputFormat(item)
    );
  }

  syncFormatSelects();

  if (syncForm) {
    applyConfigToForm({ force: forceForm });
  }
}

async function loadFiles() {
  const sourceDir = els.sourceDir.value.trim();
  const query = new URLSearchParams({
    sourceDir,
    includeNonKeyFiles: "false",
  });

  setFilesLoading(true);
  renderGroups();

  try {
    const data = await api(`/api/files?${query.toString()}`);
    state.files = data.files || [];
    state.grouped = data.grouped || { today: [], yesterday: [], earlier: [] };
    resetGroupRenderCounts();
  } finally {
    setFilesLoading(false);
    renderGroups();
  }
}

async function discoverSources() {
  const data = await api("/api/discover-sources");
  const sources = data.sources || [];
  els.sourceSelect.innerHTML = '<option value="">Detected folders...</option>';

  for (const src of sources) {
    const option = document.createElement("option");
    option.value = src;
    option.textContent = src;
    els.sourceSelect.appendChild(option);
  }
}

async function saveSettings() {
  const outputMode = els.outputMode.value === "custom" ? "custom" : "downloads";
  const outputFormat = normalizeOutputFormat(els.outputFormat.value);
  const outputDir = els.outputDir.value.trim();

  if (outputMode === "custom" && !outputDir) {
    throw new Error("Custom output folder is required when mode is Custom.");
  }

  const payload = {
    sourceDir: els.sourceDir.value.trim(),
    outputMode,
    outputFormat,
    outputDir,
    pollSeconds: Number.parseInt(els.pollSeconds.value, 10),
    autoStartWatcher: els.autoStartWatcher.checked,
    includeNonKeyFiles: false,
  };

  const data = await api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  state.config = data.config;
  state.ui.settingsDirty = false;
  state.ui.manualDestinationTouched = false;
  applyConfigToForm({ force: true });
  setStatusText("Settings saved.");
  showToast(`Core settings updated. Format: ${outputFormatLabel(outputFormat)}.`, "success");
}

async function ensureSettingsSavedIfDirty() {
  if (!state.ui.settingsDirty) return;

  const accept = await confirmDialog(
    "Save Settings First",
    "You have unsaved settings. Save now before fixing files?",
    { confirmText: "Save and Continue" }
  );

  if (!accept) {
    throw new Error("Action canceled: settings are not saved.");
  }

  setStatusText("Saving unsaved settings...");
  await saveSettings();
  await Promise.all([loadStatus({ syncForm: true, forceForm: true }), loadFiles()]);
}

function getManualDestinationPayload() {
  const destinationMode =
    els.manualDestinationMode.value === "custom" ? "custom" : "downloads";
  const destinationDir = els.manualDestinationDir.value.trim();

  const outputFormat =
    els.manualOutputFormat.value === "core"
      ? normalizeOutputFormat(state.config?.outputFormat || els.outputFormat.value || "mp4")
      : normalizeOutputFormat(els.manualOutputFormat.value);

  if (destinationMode === "custom" && !destinationDir) {
    throw new Error("Custom destination mode requires a destination folder.");
  }

  return {
    destinationMode,
    destinationDir,
    outputFormat,
  };
}

function getCheckedFilePaths() {
  const checks = document.querySelectorAll(".file-groups .file-check:checked:not(.cloud-check)");
  return [...checks].map((check) => decodeURIComponent(check.dataset.path));
}

async function checkOutputConflict(filePath, destination) {
  return api("/api/check-output", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputPath: filePath,
      destinationMode: destination.destinationMode,
      destinationDir: destination.destinationDir,
      outputFormat: destination.outputFormat,
    }),
  });
}

async function openPathAction(action, targetPath) {
  if (!targetPath) return;
  await api("/api/open-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      targetPath,
    }),
  });
}

async function showOutputActionsModal(options = {}) {
  const {
    title = "Export Ready",
    message = "Your file is ready.",
    outputPath = "",
    tone = "primary",
  } = options;

  const modalResult = await openModal({
    title,
    message,
    confirmText: "Open Folder",
    secondaryText: "Locate File",
    cancelText: "Close",
    hideSecondary: false,
    tone,
  });

  if (modalResult === "confirm") {
    await openPathAction("open_folder", outputPath);
    return;
  }
  if (modalResult === "secondary") {
    await openPathAction("reveal_file", outputPath);
  }
}

async function fixSingleFile(filePath) {
  await ensureSettingsSavedIfDirty();
  const destination = getManualDestinationPayload();
  const formatText = outputFormatLabel(destination.outputFormat);
  const shortName = displayFileName(fileNameFromPath(filePath));

  const accepted = await confirmDialog(
    "Fix File",
    `Create playable ${formatText} for ${shortName}?`,
    { confirmText: "Fix Now" }
  );
  if (!accepted) return;

  const outputCheck = await checkOutputConflict(filePath, destination);
  if (outputCheck.exists) {
    const duplicateDecision = await openModal({
      title: "File Already Exists",
      message:
        "A fixed file with this name already exists in the destination folder. You can locate it now or continue.",
      confirmText: "Continue Fix",
      secondaryText: "Locate Existing File",
      cancelText: "Cancel",
      hideSecondary: false,
      tone: "danger",
    });

    if (duplicateDecision === "secondary") {
      await openPathAction("reveal_file", outputCheck.outputPath);
      return;
    }
    if (duplicateDecision !== "confirm") {
      return;
    }
  }

  const result = await api("/api/fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputPath: filePath,
      destinationMode: destination.destinationMode,
      destinationDir: destination.destinationDir,
      outputFormat: destination.outputFormat,
    }),
  });

  if (result.skipped) {
    showToast(`Existing output kept for ${shortName}.`, "info", 4800);
    await showOutputActionsModal({
      title: "File Already Exists",
      message: `${shortName} is already available in the selected folder. You can open the folder or locate the file.`,
      outputPath: result.outputPath,
      tone: "ghost",
    });
    return;
  }

  showToast(`Fixed ${shortName} as ${formatText}`, "success");
  await showOutputActionsModal({
    title: "Export Successful",
    message: `${shortName} was exported successfully. Open the folder or locate the file now.`,
    outputPath: result.outputPath,
    tone: "primary",
  });
}

async function fixSelectedFiles() {
  await ensureSettingsSavedIfDirty();
  const inputPaths = getCheckedFilePaths();

  if (inputPaths.length === 0) {
    await alertDialog("No File Selected", "Select at least one file to fix.");
    return;
  }

  const destination = getManualDestinationPayload();
  const formatText = outputFormatLabel(destination.outputFormat);
  const accepted = await confirmDialog(
    "Fix Selected Files",
    `Fix ${inputPaths.length} selected file(s) to ${formatText} now?`,
    { confirmText: "Run Batch Fix" }
  );
  if (!accepted) return;

  const result = await api("/api/fix-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputPaths,
      destinationMode: destination.destinationMode,
      destinationDir: destination.destinationDir,
      outputFormat: destination.outputFormat,
    }),
  });

  showToast(
    `Batch done. Success: ${result.successCount}, Failed: ${result.failCount}`,
    result.failCount > 0 ? "error" : "success",
    4800
  );

  if (result.successCount > 0) {
    const firstSuccess = (result.results || []).find((item) => item && item.ok && item.outputPath);
    if (firstSuccess?.outputPath) {
      await showOutputActionsModal({
        title: "Batch Export Complete",
        message:
          "The selected files were processed. You can open the destination folder or locate one exported file.",
        outputPath: firstSuccess.outputPath,
        tone: "primary",
      });
    }
  }
}

function wireRowActions() {
  document.querySelectorAll(".fix-one").forEach((button) => {
    button.addEventListener("click", async () => {
      const filePath = decodeURIComponent(button.dataset.path);
      setBusy(button, true);
      try {
        await fixSingleFile(filePath);
        await loadFiles();
      } catch (error) {
        showToast(error.message, "error", 5200);
      } finally {
        setBusy(button, false);
      }
    });
  });
}

function wireLoadMoreButtons() {
  document.querySelectorAll(".load-more").forEach((button) => {
    button.addEventListener("click", () => {
      const key = String(button.dataset.group || "");
      if (!Object.prototype.hasOwnProperty.call(state.ui.groupRenderCount, key)) return;
      state.ui.groupRenderCount[key] += GROUP_PAGE_SIZE;
      renderGroups();
    });
  });
}

function wireModalEvents() {
  els.modalConfirmBtn.addEventListener("click", () => closeModal("confirm"));
  els.modalSecondaryBtn.addEventListener("click", () => closeModal("secondary"));
  els.modalCancelBtn.addEventListener("click", () => closeModal("cancel"));

  els.modalBackdrop.addEventListener("click", (event) => {
    if (event.target === els.modalBackdrop) {
      closeModal("cancel");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (state.ui.modalResolver && event.key === "Escape") {
      closeModal("cancel");
    }
  });
}

function wireEvents() {
  els.themeToggle.addEventListener("click", () => {
    applyTheme(state.ui.theme === "dark" ? "light" : "dark");
  });

  els.modeDesktopBtn?.addEventListener("click", () => {
    setAppMode("desktop");
  });

  els.modeCloudBtn?.addEventListener("click", () => {
    setAppMode("cloud");
  });

  els.runtimeCopyCmdBtn?.addEventListener("click", async () => {
    try {
      const copied = await copyToClipboard(RUNTIME_ONE_LINER);
      if (!copied) {
        throw new Error("Clipboard access failed.");
      }
      setRuntimeHint("PowerShell command copied. Paste in PowerShell and run.", false);
      showToast("Runtime command copied to clipboard.", "success");
    } catch (error) {
      setRuntimeHint("Copy failed. Use the Download Launcher button instead.", true);
      showToast(error.message || "Unable to copy command.", "error", 4800);
    }
  });

  els.runtimeConnectBtn?.addEventListener("click", async () => {
    setBusy(els.runtimeConnectBtn, true);
    try {
      await connectDesktopRuntime({ silent: false });
    } catch (error) {
      setRuntimeHint(error.message, true);
      showToast(error.message, "error", 5200);
    } finally {
      setBusy(els.runtimeConnectBtn, false);
    }
  });

  els.runtimeOpenLocalBtn?.addEventListener("click", () => {
    window.open("http://127.0.0.1:3210", "_blank", "noopener,noreferrer");
  });

  const settingsInputs = [
    els.sourceDir,
    els.outputMode,
    els.outputFormat,
    els.outputDir,
    els.pollSeconds,
    els.autoStartWatcher,
  ];

  for (const input of settingsInputs) {
    input.addEventListener("input", markSettingsDirty);
    input.addEventListener("change", markSettingsDirty);
  }

  const manualInputs = [
    els.manualDestinationMode,
    els.manualOutputFormat,
    els.manualDestinationDir,
  ];

  for (const input of manualInputs) {
    input.addEventListener("input", () => {
      state.ui.manualDestinationTouched = true;
    });
    input.addEventListener("change", () => {
      state.ui.manualDestinationTouched = true;
    });
  }

  els.discoverBtn.addEventListener("click", async () => {
    try {
      await discoverSources();
      showToast("Source discovery complete.", "info");
    } catch (error) {
      setStatusText(error.message, true);
      showToast(error.message, "error", 5200);
    }
  });

  els.sourceSelect.addEventListener("change", () => {
    if (!els.sourceSelect.value) return;
    els.sourceDir.value = els.sourceSelect.value;
    markSettingsDirty();
  });

  els.sourceBrowseBtn.addEventListener("click", async () => {
    try {
      const picked = await pickFolder(els.sourceDir.value.trim());
      if (!picked) return;
      els.sourceDir.value = picked;
      markSettingsDirty();
    } catch (error) {
      showToast(error.message, "error", 5200);
    }
  });

  els.outputBrowseBtn.addEventListener("click", async () => {
    try {
      const picked = await pickFolder(els.outputDir.value.trim());
      if (!picked) return;
      els.outputDir.value = picked;
      markSettingsDirty();
    } catch (error) {
      showToast(error.message, "error", 5200);
    }
  });

  els.manualDestinationBrowseBtn.addEventListener("click", async () => {
    try {
      const picked = await pickFolder(els.manualDestinationDir.value.trim());
      if (!picked) return;
      els.manualDestinationDir.value = picked;
      state.ui.manualDestinationTouched = true;
    } catch (error) {
      showToast(error.message, "error", 5200);
    }
  });

  els.outputMode.addEventListener("change", syncDestinationFieldStates);
  els.manualDestinationMode.addEventListener("change", syncDestinationFieldStates);

  els.saveSettingsBtn.addEventListener("click", async () => {
    const accepted = await confirmDialog(
      "Save Core Settings",
      "Apply these core settings now?",
      { confirmText: "Save Settings" }
    );
    if (!accepted) return;

    setBusy(els.saveSettingsBtn, true);
    setStatusText("Saving...");

    try {
      await saveSettings();
      await Promise.all([loadStatus({ syncForm: true, forceForm: true }), loadFiles()]);
    } catch (error) {
      setStatusText(error.message, true);
      showToast(error.message, "error", 5200);
    } finally {
      setBusy(els.saveSettingsBtn, false);
    }
  });

  els.refreshFilesBtn.addEventListener("click", async () => {
    try {
      await loadFiles();
      showToast("File list refreshed.", "info");
    } catch (error) {
      showToast(error.message, "error", 5200);
    }
  });

  els.fileSearch.addEventListener("input", () => {
    resetGroupRenderCounts();
    renderGroups();
  });

  els.fixSelectedBtn.addEventListener("click", async () => {
    setBusy(els.fixSelectedBtn, true);
    try {
      await fixSelectedFiles();
      await loadFiles();
    } catch (error) {
      showToast(error.message, "error", 5200);
    } finally {
      setBusy(els.fixSelectedBtn, false);
    }
  });

  els.selectAll.addEventListener("change", () => {
    const checks = document.querySelectorAll(
      ".file-groups .file-check:not(.cloud-check):not(:disabled)"
    );
    checks.forEach((check) => {
      check.checked = els.selectAll.checked;
    });
  });
}

async function init() {
  window.addEventListener("beforeunload", () => {
    clearCloudObjectUrls();
  });

  initializeTheme();
  wireModalEvents();
  wireEvents();
  wireCloudActions();
  observeRevealNodes();

  try {
    const connected = await connectDesktopRuntime({ silent: true });
    if (!connected) {
      return;
    }
  } catch (error) {
    setStatusText(error.message, true);
    showToast(error.message, "error", 5200);
  }

  window.setInterval(async () => {
    if (!state.ui.localRuntimeAvailable) return;
    try {
      await loadStatus();
    } catch {
      // Ignore periodic refresh errors.
    }
  }, 10000);
}

init();
