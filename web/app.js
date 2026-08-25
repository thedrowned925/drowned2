const OWNER = "thedrowned925";
const REPO = "drowned2";
const BRANCH = "main";
const WORKFLOW = "extract-file.yml";
const EXTRACT_TAG = "drowned2-extracts";

const state = {
  catalog: null,
  game: null,
  channel: null,
  manifest: null,
  manifestPath: "",
  currentPath: "",
  selectedFile: null,
  activeRequest: null,
};

const $ = (id) => document.getElementById(id);
const gameList = $("gameList");
const gameTitle = $("gameTitle");
const gameMeta = $("gameMeta");
const channelSelect = $("channelSelect");
const searchInput = $("searchInput");
const breadcrumbs = $("breadcrumbs");
const fileRows = $("fileRows");
const fileDialog = $("fileDialog");
const settingsDialog = $("settingsDialog");
const connectionBadge = $("connectionBadge");

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function basename(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "download.bin";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message, timeout = 3600) {
  const node = $("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => node.classList.add("hidden"), timeout);
}

function getToken() {
  return sessionStorage.getItem("drowned2.githubToken") || "";
}

function updateConnectionBadge() {
  const ready = Boolean(getToken());
  connectionBadge.textContent = ready ? "GitHub hazır" : "GitHub token gerekli";
  connectionBadge.className = `badge ${ready ? "ok" : "warn"}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} yüklenemedi (${response.status})`);
  return response.json();
}

async function githubApi(path, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`https://api.github.com${path}`, { ...options, headers, cache: "no-store" });
  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      detail = data.message || JSON.stringify(data);
    } catch (_) {
      detail = await response.text().catch(() => "");
    }
    throw new Error(`GitHub API ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function preferredChannel(game) {
  const channels = game?.channels || {};
  if (channels.stable) return "stable";
  return Object.keys(channels)[0] || null;
}

function renderGames() {
  const games = state.catalog?.games || [];
  if (!games.length) {
    gameList.innerHTML = '<div class="empty">Henüz yedeklenmiş oyun yok.</div>';
    return;
  }
  gameList.innerHTML = games.map((game) => {
    const active = state.game?.id === game.id && state.game?.platform === game.platform;
    const channel = game.channels?.[preferredChannel(game)];
    return `<button class="game-button ${active ? "active" : ""}" data-game-id="${escapeHtml(game.id)}" data-platform="${escapeHtml(game.platform)}">
      <strong>${escapeHtml(game.title || game.id)}</strong>
      <small>${escapeHtml((game.platform || "pc").toUpperCase())} · ${formatBytes(channel?.size || 0)}</small>
    </button>`;
  }).join("");

  gameList.querySelectorAll(".game-button").forEach((button) => {
    button.addEventListener("click", () => {
      const game = games.find((item) => item.id === button.dataset.gameId && item.platform === button.dataset.platform);
      if (game) loadGame(game).catch(showError);
    });
  });
}

async function loadGame(game, requestedChannel = null) {
  state.game = game;
  state.currentPath = "";
  searchInput.value = "";
  const channels = Object.keys(game.channels || {});
  const channelName = requestedChannel && game.channels?.[requestedChannel] ? requestedChannel : preferredChannel(game);
  state.channel = channelName;
  channelSelect.innerHTML = channels.map((name) => `<option value="${escapeHtml(name)}" ${name === channelName ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");
  channelSelect.disabled = channels.length < 2;

  const channel = game.channels?.[channelName];
  if (!channel?.manifest_path) throw new Error("Bu oyun için manifest_path bulunamadı.");
  state.manifestPath = channel.manifest_path.replace(/^\/+/, "");
  state.manifest = await fetchJson(`./${state.manifestPath}`);

  gameTitle.textContent = game.title || game.id;
  const steamId = game.media?.steam_app_id || game.steam_app_id;
  gameMeta.textContent = [
    `${(game.platform || "pc").toUpperCase()} / ${channelName}`,
    channel.version ? `v${channel.version}` : null,
    formatBytes(state.manifest.total_size || channel.size),
    steamId ? `Steam ${steamId}` : null,
  ].filter(Boolean).join(" · ");
  renderGames();
  renderBrowser();
}

function renderBreadcrumbs() {
  const parts = state.currentPath.split("/").filter(Boolean);
  const nodes = [{ label: "Kök", path: "" }];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    nodes.push({ label: part, path: acc });
  }
  breadcrumbs.innerHTML = nodes.map((node, index) => `${index ? '<span>/</span>' : ""}<button type="button" data-path="${escapeHtml(node.path)}">${escapeHtml(node.label)}</button>`).join("");
  breadcrumbs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentPath = button.dataset.path || "";
      searchInput.value = "";
      renderBrowser();
    });
  });
}

function directoryEntries() {
  const files = state.manifest?.files || [];
  const search = searchInput.value.trim().toLowerCase();
  if (search) {
    return files
      .filter((file) => String(file.path || "").toLowerCase().includes(search))
      .map((file) => ({ type: "file", name: basename(file.path), path: file.path, size: file.size }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  const prefix = state.currentPath ? `${state.currentPath}/` : "";
  const dirs = new Map();
  const directFiles = [];
  for (const file of files) {
    const path = String(file.path || "");
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest || rest.startsWith("../")) continue;
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      const name = rest.slice(0, slash);
      const full = prefix ? `${state.currentPath}/${name}` : name;
      const current = dirs.get(name) || { type: "dir", name, path: full, size: 0, count: 0 };
      current.size += Number(file.size || 0);
      current.count += 1;
      dirs.set(name, current);
    } else {
      directFiles.push({ type: "file", name: rest, path, size: file.size });
    }
  }
  return [...dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
    .concat(directFiles.sort((a, b) => a.name.localeCompare(b.name)));
}

function extensionLabel(name) {
  const ext = String(name).includes(".") ? String(name).split(".").pop().toUpperCase() : "DOSYA";
  return ext.length <= 8 ? ext : "DOSYA";
}

function renderBrowser() {
  renderBreadcrumbs();
  const entries = directoryEntries();
  if (!entries.length) {
    fileRows.innerHTML = '<tr><td colspan="3" class="empty">Bu konumda dosya bulunamadı.</td></tr>';
    return;
  }
  fileRows.innerHTML = entries.map((entry) => {
    const isDir = entry.type === "dir";
    const detail = isDir ? `${entry.count} dosya` : extensionLabel(entry.name);
    return `<tr data-clickable="true" data-type="${entry.type}" data-path="${escapeHtml(entry.path)}">
      <td><div class="file-name"><span class="file-icon">${isDir ? "▸" : "•"}</span><span>${escapeHtml(searchInput.value ? entry.path : entry.name)}</span></div></td>
      <td class="muted">${escapeHtml(detail)}</td>
      <td class="number">${formatBytes(entry.size)}</td>
    </tr>`;
  }).join("");

  fileRows.querySelectorAll("tr[data-clickable='true']").forEach((row) => {
    row.addEventListener("click", () => {
      if (row.dataset.type === "dir") {
        state.currentPath = row.dataset.path || "";
        searchInput.value = "";
        renderBrowser();
      } else {
        const file = (state.manifest.files || []).find((item) => item.path === row.dataset.path);
        if (file) openFile(file);
      }
    });
  });
}

function segmentsForFile(filePath) {
  const result = [];
  for (const chunk of state.manifest?.chunks || []) {
    for (const segment of chunk.segments || []) {
      if (segment.file !== filePath) continue;
      result.push({
        chunk: chunk.name,
        fileOffset: Number(segment.file_offset || 0),
        chunkOffset: Number(segment.chunk_offset || 0),
        length: Number(segment.length || 0),
      });
    }
  }
  return result.sort((a, b) => a.fileOffset - b.fileOffset);
}

function openFile(file) {
  state.selectedFile = file;
  state.activeRequest = null;
  const segments = segmentsForFile(file.path);
  $("fileDialogTitle").textContent = basename(file.path);
  $("fileDialogPath").textContent = file.path;
  $("fileDialogStats").innerHTML = [
    ["Boyut", formatBytes(file.size)],
    ["Chunk segmenti", String(segments.length)],
    ["SHA-256", file.sha256 ? `${file.sha256.slice(0, 12)}…` : "—"],
  ].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  resetProgress();
  $("downloadButton").disabled = false;
  $("downloadButton").textContent = "Dosyayı hazırla ve indir";
  fileDialog.showModal();
}

function resetProgress() {
  $("downloadProgress").classList.add("hidden");
  $("progressBar").value = 0;
  $("progressPercent").textContent = "0%";
  $("progressText").textContent = "Hazır";
}

function setProgress(percent, label) {
  $("downloadProgress").classList.remove("hidden");
  $("progressBar").value = percent;
  $("progressPercent").textContent = `${percent}%`;
  $("progressText").textContent = label;
}

function requestId() {
  if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "").slice(0, 20);
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function dispatchExtraction(file, id) {
  if (!getToken()) throw new Error("Önce Ayarlar bölümüne GitHub token'ını gir.");
  await githubApi(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      ref: BRANCH,
      inputs: {
        manifest_path: state.manifestPath,
        file_path: file.path,
        request_id: id,
      },
    }),
  });
}

async function findExtractAsset(id) {
  try {
    const release = await githubApi(`/repos/${OWNER}/${REPO}/releases/tags/${EXTRACT_TAG}`);
    return (release.assets || []).find((asset) => String(asset.name || "").startsWith(`${id}-`)) || null;
  } catch (error) {
    if (String(error.message).includes("GitHub API 404")) return null;
    throw error;
  }
}

async function findWorkflowRun(id) {
  const data = await githubApi(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`);
  return (data.workflow_runs || []).find((run) => String(run.display_title || run.name || "").includes(id)) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExtraction(id) {
  for (let attempt = 0; attempt < 1440; attempt += 1) {
    const asset = await findExtractAsset(id);
    if (asset) return asset;

    const run = await findWorkflowRun(id);
    if (!run) {
      setProgress(10, "GitHub Action kuyruğa alınıyor…");
    } else if (run.status === "queued" || run.status === "waiting" || run.status === "pending") {
      setProgress(20, "GitHub runner bekleniyor…");
    } else if (run.status === "in_progress") {
      setProgress(60, "Seçili dosya chunk aralıklarından oluşturuluyor…");
    } else if (run.status === "completed" && run.conclusion !== "success") {
      throw new Error(`Dosya çıkarma Action'ı başarısız oldu: ${run.conclusion || "unknown"}. Actions sayfasından ayrıntıya bakabilirsin.`);
    } else if (run.status === "completed") {
      setProgress(90, "Dosya Release'e yükleniyor…");
    }
    await sleep(5000);
  }
  throw new Error("Dosya çıkarma işlemi zaman aşımına uğradı.");
}

function startBrowserDownload(asset) {
  const anchor = document.createElement("a");
  anchor.href = asset.browser_download_url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function downloadSelectedFile() {
  const file = state.selectedFile;
  if (!file) return;
  const button = $("downloadButton");
  button.disabled = true;
  button.textContent = "Hazırlanıyor…";
  const id = requestId();
  state.activeRequest = id;
  try {
    setProgress(5, "İstek GitHub'a gönderiliyor…");
    await dispatchExtraction(file, id);
    const asset = await waitForExtraction(id);
    if (state.activeRequest !== id) return;
    setProgress(100, `Hazır · ${formatBytes(asset.size || file.size)}`);
    button.textContent = "Tekrar indir";
    button.disabled = false;
    toast("Dosya hazır. İndirme başlatılıyor.");
    startBrowserDownload(asset);
  } catch (error) {
    button.textContent = "Tekrar dene";
    button.disabled = false;
    showError(error);
  }
}

function showError(error) {
  console.error(error);
  toast(error?.message || String(error), 7000);
  if ($("progressText")) {
    $("downloadProgress").classList.remove("hidden");
    $("progressText").textContent = error?.message || String(error);
  }
}

async function init() {
  updateConnectionBadge();
  state.catalog = await fetchJson("./catalog.json");
  renderGames();
  const first = state.catalog?.games?.[0];
  if (first) await loadGame(first);
  else {
    gameTitle.textContent = "Arşiv boş";
    gameMeta.textContent = "İlk oyunu Drowned2 Release Manager ile yedeklediğinde burada görünecek.";
    breadcrumbs.innerHTML = '<button type="button">Kök</button>';
    fileRows.innerHTML = '<tr><td colspan="3" class="empty">Henüz oyun yok.</td></tr>';
  }
}

$("settingsButton").addEventListener("click", () => {
  $("githubTokenInput").value = getToken();
  settingsDialog.showModal();
});

$("saveSettingsButton").addEventListener("click", () => {
  const token = $("githubTokenInput").value.trim();
  if (token) sessionStorage.setItem("drowned2.githubToken", token);
  else sessionStorage.removeItem("drowned2.githubToken");
  updateConnectionBadge();
  settingsDialog.close();
  toast(token ? "GitHub token bu sekme oturumu için kaydedildi." : "GitHub token temizlendi.");
});

$("downloadButton").addEventListener("click", downloadSelectedFile);
searchInput.addEventListener("input", () => state.manifest && renderBrowser());
channelSelect.addEventListener("change", () => state.game && loadGame(state.game, channelSelect.value).catch(showError));
fileDialog.addEventListener("close", () => { state.activeRequest = null; });

init().catch(showError);
