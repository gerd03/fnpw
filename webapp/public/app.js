const GROUP_PAGE_SIZE = 14;
const CLOUD_PREVIEW_HOST_SUFFIX = ".vercel.app";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
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
  ui: {
    settingsDirty: false,
    manualDestinationTouched: false,
    theme: "dark",
    modalResolver: null,
    loadingFiles: false,
    cloudPreview: false,
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

function isCloudPreviewHost() {
  const host = String(window.location.hostname || "").toLowerCase();
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return false;
  return host.endsWith(CLOUD_PREVIEW_HOST_SUFFIX);
}

function enableCloudPreviewMode() {
  state.ui.cloudPreview = true;
  state.config = { ...CLIENT_DEFAULT_CONFIG };
  applyConfigToForm({ force: true });
  resetGroupRenderCounts();
  state.files = [];
  state.grouped = { today: [], yesterday: [], earlier: [] };
  renderGroups();

  const disabledControls = [
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
  ];

  for (const control of disabledControls) {
    if (control) {
      control.disabled = true;
    }
  }

  els.fileGroups.innerHTML = `
    <section class="file-empty reveal in-view">
      <h3>Cloud Preview Mode</h3>
      <p>
        This Vercel deployment is UI-only. Run this app on your Windows PC with
        <code>npm run dev</code> to enable fixing, folder browse, and local file scanning.
      </p>
    </section>
  `;
  els.fileCount.textContent = "0 visible / 0 total";
  setStatusText("Cloud preview mode on Vercel. Local Windows runtime is required for tools.");
}

async function api(url, options = {}) {
  if (state.ui.cloudPreview) {
    throw new Error(
      "Cloud preview mode: API is unavailable on Vercel. Run locally on Windows for full features."
    );
  }
  const response = await fetch(url, options);
  const json = await response.json();
  if (!response.ok || json.ok === false) {
    throw new Error(json.error || `Request failed: ${response.status}`);
  }
  return json;
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
  const checks = document.querySelectorAll(".file-check:checked");
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
    const checks = document.querySelectorAll(".file-check:not(:disabled)");
    checks.forEach((check) => {
      check.checked = els.selectAll.checked;
    });
  });
}

async function init() {
  initializeTheme();
  wireModalEvents();
  wireEvents();
  observeRevealNodes();

  if (isCloudPreviewHost()) {
    enableCloudPreviewMode();
    return;
  }

  try {
    await Promise.all([
      loadStatus({ syncForm: true, forceForm: true }),
      discoverSources(),
      loadFiles(),
    ]);
  } catch (error) {
    setStatusText(error.message, true);
    showToast(error.message, "error", 5200);
  }

  window.setInterval(async () => {
    try {
      await loadStatus();
    } catch {
      // Ignore periodic refresh errors.
    }
  }, 10000);
}

init();
