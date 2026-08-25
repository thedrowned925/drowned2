const RANGE_SLICE_SIZE = 32 * 1024 * 1024;
const PREVIEW_LIMIT = 64 * 1024 * 1024;
const BLOB_FALLBACK_LIMIT = 512 * 1024 * 1024;

const state = {
  catalog: null,
  game: null,
  channel: null,
  manifest: null,
  currentPath: "",
  selectedFile: null,
  previewUrl: null,
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

function dirname(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message, timeout = 3200) {
  const node = $("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => node.classList.add("hidden"), timeout);
}

function getSettings() {
  return {
    proxyUrl: (localStorage.getItem("drowned2.proxyUrl") || "").replace(/\/+$/, ""),
    accessKey: localStorage.getItem("drowned2.accessKey") || "",
  };
}

function updateConnectionBadge() {
  const { proxyUrl } = getSettings();
  connectionBadge.textContent = proxyUrl ? "Range proxy hazır" : "Proxy ayarlanmadı";
  connectionBadge.className = `badge ${proxyUrl ? "ok" : "warn"}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} yüklenemedi (${response.status})`);
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
  state.manifest = await fetchJson(`./${channel.manifest_path.replace(/^\/+/, "")}`);

  gameTitle.textContent = game.title || game.id;
  const steamId = game.media?.steam_app_id || game.steam_app_id;
  const parts = [
    `${(game.platform || "pc").toUpperCase()} / ${channelName}`,
    channel.version ? `v${channel.version}` : null,
    formatBytes(state.manifest.total_size || channel.size),
    steamId ? `Steam ${steamId}` : null,
  ].filter(Boolean);
  gameMeta.textContent = parts.join(" · ");
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

function extensionLabel(name) {
  const ext = String(name).includes(".") ? String(name).split(".").pop().toUpperCase() : "DOSYA";
  return ext.length <= 8 ? ext : "DOSYA";
}

function segmentsForFile(filePath) {
  const result = [];
  for (const chunk of state.manifest?.chunks || []) {
    for (const segment of chunk.segments || []) {
      if (segment.file !== filePath) continue;
      result.push({
        chunk: chunk.name,
        chunkSize: Number(chunk.size || 0),
        chunkOffset: Number(segment.chunk_offset || 0),
        fileOffset: Number(segment.file_offset || 0),
        length: Number(segment.length || 0),
      });
    }
  }
  return result.sort((a, b) => a.fileOffset - b.fileOffset);
}

function slicedRanges(filePath) {
  const slices = [];
  for (const segment of segmentsForFile(filePath)) {
    let consumed = 0;
    while (consumed < segment.length) {
      const length = Math.min(RANGE_SLICE_SIZE, segment.length - consumed);
      slices.push({
        chunk: segment.chunk,
        start: segment.chunkOffset + consumed,
        end: segment.chunkOffset + consumed + length - 1,
        fileOffset: segment.fileOffset + consumed,
        length,
      });
      consumed += length;
    }
  }
  return slices.sort((a, b) => a.fileOffset - b.fileOffset);
}

function openFile(file) {
  state.selectedFile = file;
  clearPreview();
  const segments = segmentsForFile(file.path);
  const slices = slicedRanges(file.path);
  $("fileDialogTitle").textContent = basename(file.path);
  $("fileDialogPath").textContent = file.path;
  $("fileDialogStats").innerHTML = [
    ["Boyut", formatBytes(file.size)],
    ["Chunk segmenti", String(segments.length)],
    ["Range isteği", String(slices.length)],
  ].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  resetProgress();
  fileDialog.showModal();
}

function resetProgress() {
  $("downloadProgress").classList.add("hidden");
  $("progressBar").value = 0;
  $("progressPercent").textContent = "0%";
  $("progressText").textContent = "Hazırlanıyor…";
}

function setProgress(done, total, label = "İndiriliyor") {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  $("downloadProgress").classList.remove("hidden");
  $("progressBar").value = percent;
  $("progressPercent").textContent = `${percent}%`;
  $("progressText").textContent = `${label} · ${formatBytes(done)} / ${formatBytes(total)}`;
}

function workerRangeUrl(slice) {
  const { proxyUrl } = getSettings();
  if (!proxyUrl) throw new Error("Önce Ayarlar'dan Cloudflare Worker URL'sini gir.");
  const release = state.manifest?.release || {};
  const query = new URLSearchParams({
    owner: release.owner || "thedrowned925",
    repo: release.repo || "drowned2",
    tag: release.tag || "",
    asset: slice.chunk,
    start: String(slice.start),
    end: String(slice.end),
  });
  return `${proxyUrl}/range?${query.toString()}`;
}

async function fetchSlice(slice) {
  const { accessKey } = getSettings();
  const headers = {};
  if (accessKey) headers["X-Drowned-Key"] = accessKey;
  const response = await fetch(workerRangeUrl(slice), { headers, cache: "no-store" });
  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch (_) { /* ignored */ }
    throw new Error(`Range isteği başarısız (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return response;
}

async function streamFileToDisk(file) {
  if (!window.showSaveFilePicker) return false;
  const handle = await window.showSaveFilePicker({ suggestedName: basename(file.path) });
  const writable = await handle.createWritable();
  const ranges = slicedRanges(file.path);
  let downloaded = 0;
  try {
    for (const range of ranges) {
      const response = await fetchSlice(range);
      if (!response.body) throw new Error("Tarayıcı streaming response sağlamadı.");
      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await writable.write(value);
        downloaded += value.byteLength;
        setProgress(downloaded, Number(file.size || 0));
      }
    }
    await writable.close();
    return true;
  } catch (error) {
    try { await writable.abort(); } catch (_) { /* ignored */ }
    throw error;
  }
}

async function fileToBlob(file, maxBytes = BLOB_FALLBACK_LIMIT) {
  const size = Number(file.size || 0);
  if (size > maxBytes) throw new Error(`Bu tarayıcıda belleğe alma sınırı ${formatBytes(maxBytes)}. Chrome/Edge ile disk streaming kullan.`);
  const ranges = slicedRanges(file.path);
  const parts = [];
  let downloaded = 0;
  for (const range of ranges) {
    const response = await fetchSlice(range);
    const bytes = new Uint8Array(await response.arrayBuffer());
    parts.push(bytes);
    downloaded += bytes.byteLength;
    setProgress(downloaded, size);
  }
  return new Blob(parts, { type: mimeFor(file.path) });
}

async function downloadSelectedFile() {
  const file = state.selectedFile;
  if (!file) return;
  $("downloadButton").disabled = true;
  $("previewButton").disabled = true;
  resetProgress();
  try {
    const streamed = await streamFileToDisk(file);
    if (!streamed) {
      const blob = await fileToBlob(file);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = basename(file.path);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    setProgress(Number(file.size || 0), Number(file.size || 0), "Tamamlandı");
    toast(`${basename(file.path)} indirildi.`);
  } catch (error) {
    if (error?.name !== "AbortError") showError(error);
  } finally {
    $("downloadButton").disabled = false;
    $("previewButton").disabled = false;
  }
}

function mimeFor(path) {
  const ext = String(path).toLowerCase().split(".").pop();
  const map = {
    txt: "text/plain", log: "text/plain", ini: "text/plain", cfg: "text/plain", md: "text/markdown",
    json: "application/json", xml: "application/xml", csv: "text/csv",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
    mp4: "video/mp4", webm: "video/webm",
  };
  return map[ext] || "application/octet-stream";
}

function clearPreview() {
  const area = $("previewArea");
  area.innerHTML = "";
  area.classList.add("hidden");
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

async function previewSelectedFile() {
  const file = state.selectedFile;
  if (!file) return;
  const mime = mimeFor(file.path);
  const previewable = mime.startsWith("text/") || mime.includes("json") || mime.includes("xml") || mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
  if (!previewable) {
    toast("Bu dosya türü için tarayıcı önizlemesi yok.");
    return;
  }
  if (Number(file.size || 0) > PREVIEW_LIMIT) {
    toast(`Önizleme sınırı ${formatBytes(PREVIEW_LIMIT)}.`);
    return;
  }

  $("previewButton").disabled = true;
  try {
    clearPreview();
    const blob = await fileToBlob(file, PREVIEW_LIMIT);
    const area = $("previewArea");
    area.classList.remove("hidden");
    if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml")) {
      const text = await blob.text();
      const pre = document.createElement("pre");
      pre.textContent = text;
      area.appendChild(pre);
      return;
    }
    state.previewUrl = URL.createObjectURL(blob);
    if (mime.startsWith("image/")) {
      const img = new Image();
      img.src = state.previewUrl;
      img.alt = basename(file.path);
      area.appendChild(img);
    } else if (mime.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = state.previewUrl;
      area.appendChild(audio);
    } else if (mime.startsWith("video/")) {
      const video = document.createElement("video");
      video.controls = true;
      video.src = state.previewUrl;
      area.appendChild(video);
    }
  } catch (error) {
    showError(error);
  } finally {
    $("previewButton").disabled = false;
  }
}

function showError(error) {
  console.error(error);
  toast(error?.message || String(error), 6500);
}

function openSettings() {
  const settings = getSettings();
  $("proxyUrlInput").value = settings.proxyUrl;
  $("accessKeyInput").value = settings.accessKey;
  settingsDialog.showModal();
}

function saveSettings() {
  const proxyUrl = $("proxyUrlInput").value.trim().replace(/\/+$/, "");
  const accessKey = $("accessKeyInput").value;
  localStorage.setItem("drowned2.proxyUrl", proxyUrl);
  localStorage.setItem("drowned2.accessKey", accessKey);
  updateConnectionBadge();
  settingsDialog.close();
  toast("İndirme geçidi ayarları kaydedildi.");
}

async function init() {
  updateConnectionBadge();
  state.catalog = await fetchJson("./catalog.json");
  renderGames();
  const first = state.catalog.games?.[0];
  if (first) await loadGame(first);
  else {
    gameTitle.textContent = "Drowned2 Arşivi";
    gameMeta.textContent = "İlk Steam yedeğini yayınladığında burada otomatik görünecek.";
    fileRows.innerHTML = '<tr><td colspan="3" class="empty">Henüz oyun yok.</td></tr>';
  }
}

channelSelect.addEventListener("change", () => {
  if (state.game) loadGame(state.game, channelSelect.value).catch(showError);
});
searchInput.addEventListener("input", renderBrowser);
$("settingsButton").addEventListener("click", openSettings);
$("saveSettingsButton").addEventListener("click", saveSettings);
$("downloadButton").addEventListener("click", downloadSelectedFile);
$("previewButton").addEventListener("click", previewSelectedFile);
fileDialog.addEventListener("close", clearPreview);

init().catch(showError);
