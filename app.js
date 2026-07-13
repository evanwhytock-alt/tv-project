const DB_NAME = "loopbox-library",
  DB_VERSION = 1,
  GIF_STORE = "gifs",
  FOLDER_STORE = "folders";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const els = {
  gifGrid: $("#gifGrid"),
  emptyState: $("#emptyState"),
  fileInput: $("#fileInput"),
  uploadButton: $("#uploadButton"),
  emptyUploadButton: $("#emptyUploadButton"),
  dropZone: $("#dropZone"),
  searchInput: $("#searchInput"),
  sortSelect: $("#sortSelect"),
  viewTitle: $("#viewTitle"),
  eyebrow: $("#eyebrow"),
  allCount: $("#allCount"),
  folderList: $("#folderList"),
  newFolderButton: $("#newFolderButton"),
  folderDialog: $("#folderDialog"),
  folderForm: $("#folderForm"),
  folderNameInput: $("#folderNameInput"),
  editDialog: $("#editDialog"),
  editForm: $("#editForm"),
  editNameInput: $("#editNameInput"),
  editFolderSelect: $("#editFolderSelect"),
  deleteGifButton: $("#deleteGifButton"),
  viewer: $("#viewer"),
  viewerStage: $("#viewerStage"),
  viewerImage: $("#viewerImage"),
  viewerName: $("#viewerName"),
  closeViewerButton: $("#closeViewerButton"),
  favouriteViewerButton: $("#favouriteViewerButton"),
  fullscreenButton: $("#fullscreenButton"),
  backgroundButton: $("#backgroundButton"),
  toast: $("#toast"),
  homeButton: $("#homeButton"),
  storageText: $("#storageText"),
  storageBar: $("#storageBar"),
  backupButton: $("#backupButton"),
  restoreButton: $("#restoreButton"),
  restoreInput: $("#restoreInput"),
  installButton: $("#installButton"),
  syncButton: $("#syncButton"),
  syncDialog: $("#syncDialog"),
  closeSyncButton: $("#closeSyncButton"),
  shareLibraryButton: $("#shareLibraryButton"),
  importLibraryButton: $("#importLibraryButton"),
  syncFileStatus: $("#syncFileStatus"),
};
let db,
  allGifRecords = [],
  gifs = [],
  folders = [],
  currentView = "all",
  editingId = null,
  viewingId = null,
  deferredInstallPrompt = null,
  toastTimer;
const objectUrls = new Map();
const SYNC_PREFIX = "loopbox-";
let syncPeer = null,
  syncConnection = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(GIF_STORE)) {
        const store = database.createObjectStore(GIF_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(FOLDER_STORE))
        database.createObjectStore(FOLDER_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function remove(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
const makeId = () =>
  crypto.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const cleanName = (name) =>
  name
    .replace(/\.gif$/i, "")
    .replace(/[_-]+/g, " ")
    .trim() || "Untitled GIF";
function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}
const formatDate = (time) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    time,
  );
function getUrl(item) {
  if (!objectUrls.has(item.id))
    objectUrls.set(item.id, URL.createObjectURL(item.blob));
  return objectUrls.get(item.id);
}
function revokeUrl(id) {
  if (objectUrls.has(id)) URL.revokeObjectURL(objectUrls.get(id));
  objectUrls.delete(id);
}
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 2400);
}
async function refresh() {
  allGifRecords = await getAll(GIF_STORE);
  gifs = allGifRecords.filter((gif) => !gif.deletedAt);
  folders = await getAll(FOLDER_STORE);
  render();
  updateStorage();
}

function filteredGifs() {
  const query = els.searchInput.value.trim().toLowerCase();
  let result = [...gifs];
  if (currentView === "recent")
    result = result.filter((g) => Date.now() - g.lastViewedAt < 2592e6);
  else if (currentView === "favourites")
    result = result.filter((g) => g.favourite);
  else if (currentView.startsWith("folder:"))
    result = result.filter((g) => g.folderId === currentView.slice(7));
  if (query)
    result = result.filter((g) => g.name.toLowerCase().includes(query));
  const sort = els.sortSelect.value;
  result.sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : sort === "oldest"
        ? a.createdAt - b.createdAt
        : b.createdAt - a.createdAt,
  );
  return result;
}
function render() {
  renderFolders();
  const visible = filteredGifs();
  els.gifGrid.replaceChildren(...visible.map(createGifCard));
  els.emptyState.classList.toggle("visible", visible.length === 0);
  els.dropZone.hidden =
    gifs.length === 0 && currentView === "all" && !els.searchInput.value;
  els.allCount.textContent = gifs.length;
  updateHeading();
}
function createGifCard(item) {
  const card = document.createElement("article");
  card.className = "gif-card";
  const preview = document.createElement("button");
  preview.className = "gif-preview";
  preview.type = "button";
  preview.setAttribute("aria-label", `Play ${item.name}`);
  const image = document.createElement("img");
  image.src = getUrl(item);
  image.alt = "";
  image.loading = "lazy";
  preview.append(image);
  preview.addEventListener("click", () => openViewer(item.id));
  const meta = document.createElement("div");
  meta.className = "gif-meta";
  const copy = document.createElement("div");
  copy.className = "gif-copy";
  const title = document.createElement("strong");
  title.textContent = item.name;
  const sub = document.createElement("span");
  sub.textContent = `${formatBytes(item.size)} · ${formatDate(item.createdAt)}`;
  copy.append(title, sub);
  const favourite = document.createElement("button");
  favourite.className = `card-action${item.favourite ? " favourited" : ""}`;
  favourite.type = "button";
  favourite.setAttribute(
    "aria-label",
    item.favourite ? "Remove favourite" : "Add favourite",
  );
  favourite.textContent = item.favourite ? "♥" : "♡";
  favourite.addEventListener("click", () => toggleFavourite(item.id));
  const edit = document.createElement("button");
  edit.className = "card-action edit";
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${item.name}`);
  edit.textContent = "•••";
  edit.addEventListener("click", () => openEdit(item.id));
  meta.append(copy, favourite, edit);
  card.append(preview, meta);
  return card;
}
function renderFolders() {
  els.folderList.replaceChildren(
    ...folders
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => {
        const button = document.createElement("button");
        button.className = `nav-item${currentView === `folder:${folder.id}` ? " active" : ""}`;
        button.type = "button";
        button.dataset.folder = `folder:${folder.id}`;
        const count = gifs.filter((g) => g.folderId === folder.id).length;
        const icon = document.createElement("span");
        icon.className = "nav-icon";
        icon.textContent = "▱";
        const name = document.createElement("span");
        name.textContent = folder.name;
        const number = document.createElement("span");
        number.className = "count";
        number.textContent = count;
        button.append(icon, name, number);
        button.addEventListener("click", () => setView(button.dataset.folder));
        return button;
      }),
  );
  $$(".nav-item[data-folder]").forEach((button) => {
    if (button.closest("#folderList")) return;
    button.classList.toggle("active", button.dataset.folder === currentView);
  });
  els.editFolderSelect.replaceChildren(
    new Option("No folder", ""),
    ...folders.map((f) => new Option(f.name, f.id)),
  );
}
function updateHeading() {
  let title = "All GIFs";
  if (currentView === "recent") title = "Recent";
  if (currentView === "favourites") title = "Favourites";
  if (currentView.startsWith("folder:"))
    title =
      folders.find((f) => f.id === currentView.slice(7))?.name || "Folder";
  els.viewTitle.textContent = title;
  els.eyebrow.textContent = currentView.startsWith("folder:")
    ? "FOLDER"
    : "YOUR LIBRARY";
}
function setView(view) {
  currentView = view;
  render();
}

async function addFiles(fileList) {
  const files = [...fileList],
    valid = files.filter(
      (file) =>
        file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif"),
    );
  if (!valid.length) return showToast("Choose a GIF file");
  for (const file of valid) {
    const now = Date.now();
    await put(GIF_STORE, {
      id: makeId(),
      name: cleanName(file.name),
      blob: file,
      size: file.size,
      createdAt: now,
      updatedAt: now,
      lastViewedAt: now,
      favourite: false,
      folderId: "",
    });
  }
  await refresh();
  showToast(`${valid.length} GIF${valid.length === 1 ? "" : "s"} added`);
}
async function toggleFavourite(id) {
  const item = gifs.find((g) => g.id === id);
  if (!item) return;
  item.favourite = !item.favourite;
  item.updatedAt = Date.now();
  await put(GIF_STORE, item);
  if (viewingId === id)
    els.favouriteViewerButton.textContent = item.favourite ? "♥" : "♡";
  await refresh();
}
async function openViewer(id) {
  const item = gifs.find((g) => g.id === id);
  if (!item) return;
  viewingId = id;
  item.lastViewedAt = Date.now();
  await put(GIF_STORE, item);
  els.viewerImage.src = getUrl(item);
  els.viewerImage.alt = item.name;
  els.viewerName.textContent = item.name;
  els.favouriteViewerButton.textContent = item.favourite ? "♥" : "♡";
  setFit(localStorage.getItem("loopbox-fit") || "contain");
  els.viewer.hidden = false;
  document.body.style.overflow = "hidden";
  localStorage.setItem("loopbox-last-gif", id);
}
function closeViewer() {
  els.viewer.hidden = true;
  document.body.style.overflow = "";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  viewingId = null;
}
function setFit(fit) {
  els.viewerImage.dataset.fit = fit;
  localStorage.setItem("loopbox-fit", fit);
  $$(".viewer-controls [data-fit]").forEach((button) =>
    button.classList.toggle("active", button.dataset.fit === fit),
  );
}
function openEdit(id) {
  const item = gifs.find((g) => g.id === id);
  if (!item) return;
  editingId = id;
  els.editNameInput.value = item.name;
  els.editFolderSelect.value = item.folderId || "";
  els.editDialog.showModal();
}
async function updateStorage() {
  const ownBytes = gifs.reduce((total, gif) => total + (gif.size || 0), 0);
  els.storageText.textContent = formatBytes(ownBytes);
  if (navigator.storage?.estimate) {
    const { usage = ownBytes, quota = 1 } = await navigator.storage.estimate();
    els.storageBar.style.width = `${Math.min(100, (usage / quota) * 100)}%`;
    els.storageText.title = `${formatBytes(usage)} used of roughly ${formatBytes(quota)}`;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function buildBackupFile() {
  const exported = [];
  for (const gif of gifs)
    exported.push({ ...gif, blob: await blobToDataUrl(gif.blob) });
  const data = JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    folders,
    gifs: exported,
  });
  return new File(
    [data],
    `loopbox-library-${new Date().toISOString().slice(0, 10)}.json`,
    {
      type: "application/json",
    },
  );
}
function downloadBackupFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportBackup() {
  if (!gifs.length) return showToast("Nothing to back up yet");
  showToast("Preparing backup…");
  downloadBackupFile(await buildBackupFile());
  showToast("Backup downloaded");
}
async function shareLibraryFile() {
  if (!gifs.length) return showToast("Upload a GIF first");
  els.syncFileStatus.hidden = false;
  els.syncFileStatus.textContent = "Preparing your library file…";
  try {
    const file = await buildBackupFile();
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: "Loopbox library",
        text: "Import this file into Loopbox on your other device.",
        files: [file],
      });
      els.syncFileStatus.textContent =
        "Library file sent. Import it on the other device.";
    } else {
      downloadBackupFile(file);
      els.syncFileStatus.textContent =
        "Library downloaded. Move it to the other device, then import it.";
    }
  } catch (error) {
    els.syncFileStatus.textContent =
      error?.name === "AbortError"
        ? "Sharing cancelled."
        : "Couldn’t create the file. Try again.";
  }
}
const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();
async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.version !== 1 || !Array.isArray(parsed.gifs))
      throw new Error("Invalid backup");
    for (const folder of parsed.folders || []) await put(FOLDER_STORE, folder);
    for (const gif of parsed.gifs)
      await put(GIF_STORE, { ...gif, blob: await dataUrlToBlob(gif.blob) });
    await refresh();
    if (els.syncDialog.open) {
      els.syncFileStatus.hidden = false;
      els.syncFileStatus.textContent = `Import complete — ${gifs.length} GIF${gifs.length === 1 ? "" : "s"} saved.`;
    }
    showToast("Backup imported");
  } catch {
    showToast("That backup file didn’t work");
  }
}

function resetSyncUi() {
  els.syncChoice.hidden = false;
  els.syncSession.hidden = true;
  els.syncCode.textContent = "------";
  els.syncStatus.textContent = "Starting secure connection…";
  els.syncProgressBar.style.width = "8%";
  els.syncProgressBar.style.background = "";
  els.syncCodeInput.value = "";
}

function destroySyncConnection() {
  if (syncConnection?.open) syncConnection.close();
  if (syncPeer && !syncPeer.destroyed) syncPeer.destroy();
  syncConnection = null;
  syncPeer = null;
}

function openSyncDialog() {
  destroySyncConnection();
  els.syncFileStatus.hidden = true;
  els.syncFileStatus.textContent = "";
  els.syncDialog.showModal();
}

function showSyncSession(code, status) {
  els.syncChoice.hidden = true;
  els.syncSession.hidden = false;
  els.syncCode.textContent = code;
  els.syncStatus.textContent = status;
}

function makeSyncCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = crypto.getRandomValues(new Uint8Array(6));
  return [...values].map((value) => alphabet[value % alphabet.length]).join("");
}

function cleanSyncCode(value) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function syncFailed(message) {
  els.syncStatus.textContent = message;
  els.syncProgressBar.style.width = "100%";
  els.syncProgressBar.style.background = "var(--danger)";
}

function startSyncHost() {
  if (!window.Peer)
    return syncFailed("Sync couldn’t load. Check your internet.");
  destroySyncConnection();
  const code = makeSyncCode();
  showSyncSession(code, "Creating your code…");
  syncPeer = new Peer(`${SYNC_PREFIX}${code}`, { debug: 2 });
  syncPeer.on("open", () => {
    els.syncStatus.textContent = "Enter this code on your other device";
    els.syncProgressBar.style.width = "14%";
  });
  syncPeer.on("connection", (connection) => {
    if (syncConnection?.open) return connection.close();
    attachSyncConnection(connection);
  });
  syncPeer.on("error", (error) => {
    if (error.type === "unavailable-id") return startSyncHost();
    syncFailed("Couldn’t create the code. Try again.");
  });
}

function joinSyncHost() {
  if (!window.Peer)
    return syncFailed("Sync couldn’t load. Check your internet.");
  const code = cleanSyncCode(els.syncCodeInput.value);
  els.syncCodeInput.value = code;
  if (code.length !== 6) return showToast("Enter the 6-character code");
  destroySyncConnection();
  showSyncSession(code, "Finding your other device…");
  const clientId = `${SYNC_PREFIX}client-${makeSyncCode()}-${Date.now().toString(36)}`;
  syncPeer = new Peer(clientId, { debug: 2 });
  syncPeer.on("open", () => {
    els.syncStatus.textContent = "Code found — connecting devices…";
    attachSyncConnection(
      syncPeer.connect(`${SYNC_PREFIX}${code}`, {
        reliable: true,
        serialization: "binary",
      }),
    );
  });
  syncPeer.on("error", (error) => {
    syncFailed(
      error.type === "peer-unavailable"
        ? "Code not found. Check it and try again."
        : "Couldn’t connect. Try again.",
    );
  });
}

function attachSyncConnection(connection) {
  syncConnection = connection;
  const state = {
    started: false,
    sendDone: false,
    receiveDone: false,
    completed: false,
    received: 0,
    total: 0,
    pendingMeta: null,
    records: new Map(allGifRecords.map((record) => [record.id, record])),
    queue: Promise.resolve(),
  };
  const begin = () => {
    if (state.started) return;
    clearTimeout(connectionTimeout);
    state.started = true;
    els.syncStatus.textContent = "Connected — merging libraries…";
    els.syncProgressBar.style.width = "24%";
    sendSyncLibrary(connection, state).catch(() =>
      syncFailed("The transfer stopped. Keep both devices open and try again."),
    );
  };
  const connectionTimeout = setTimeout(() => {
    if (!state.started)
      syncFailed(
        "Couldn’t reach the other device. Check the code and try again.",
      );
  }, 15000);
  connection.on("open", begin);
  if (connection.open) begin();
  connection.on("data", (data) => {
    state.queue = state.queue
      .then(() => handleSyncData(data, state))
      .catch(() => syncFailed("A GIF couldn’t transfer. Try syncing again."));
  });
  connection.on("error", () =>
    syncFailed("The connection failed. Keep both devices open and try again."),
  );
  connection.on("close", () => {
    if (!state.completed) syncFailed("Connection closed before sync finished.");
  });
}

async function waitForSendBuffer(connection) {
  while (connection.open && connection.bufferSize > 8) {
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  if (!connection.open) throw new Error("Connection closed");
}

async function sendSyncLibrary(connection, state) {
  const records = await getAll(GIF_STORE);
  const currentFolders = await getAll(FOLDER_STORE);
  connection.send({
    type: "start",
    version: 1,
    total: records.length,
    folders: currentFolders,
  });
  for (const record of records) {
    await waitForSendBuffer(connection);
    if (record.deletedAt) {
      connection.send({
        type: "gif-delete",
        record: {
          id: record.id,
          deletedAt: record.deletedAt,
          updatedAt: record.updatedAt || record.deletedAt,
        },
      });
      continue;
    }
    const { blob, ...metadata } = record;
    connection.send({ type: "gif-meta", record: metadata });
    connection.send(blob);
  }
  await waitForSendBuffer(connection);
  connection.send({ type: "complete" });
  state.sendDone = true;
  await finishSyncIfReady(state);
}

function recordTime(record) {
  return record?.updatedAt || record?.createdAt || 0;
}

async function handleSyncData(data, state) {
  if (data?.type === "start") {
    state.total = Number(data.total) || 0;
    for (const folder of data.folders || []) await put(FOLDER_STORE, folder);
    els.syncStatus.textContent = state.total
      ? `Receiving 0 of ${state.total} GIFs…`
      : "Other device has no extra GIFs";
    return;
  }
  if (data?.type === "gif-meta") {
    const existing = state.records.get(data.record.id);
    state.pendingMeta = {
      record: data.record,
      accept: !existing || recordTime(data.record) >= recordTime(existing),
    };
    return;
  }
  if (
    data instanceof Blob ||
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data)
  ) {
    if (!state.pendingMeta) return;
    const { record, accept } = state.pendingMeta;
    state.pendingMeta = null;
    const blob =
      data instanceof Blob ? data : new Blob([data], { type: "image/gif" });
    if (accept) {
      const incoming = { ...record, blob, size: record.size || blob.size };
      revokeUrl(incoming.id);
      await put(GIF_STORE, incoming);
      state.records.set(incoming.id, incoming);
    }
    updateSyncReceiveProgress(state);
    return;
  }
  if (data?.type === "gif-delete") {
    const existing = state.records.get(data.record.id);
    if (!existing || recordTime(data.record) >= recordTime(existing)) {
      const tombstone = { ...(existing || {}), ...data.record };
      revokeUrl(tombstone.id);
      await put(GIF_STORE, tombstone);
      state.records.set(tombstone.id, tombstone);
    }
    updateSyncReceiveProgress(state);
    return;
  }
  if (data?.type === "complete") {
    state.receiveDone = true;
    await finishSyncIfReady(state);
  }
}

function updateSyncReceiveProgress(state) {
  state.received += 1;
  const percent = state.total
    ? 24 + Math.round((state.received / state.total) * 66)
    : 90;
  els.syncProgressBar.style.width = `${Math.min(90, percent)}%`;
  els.syncStatus.textContent = `Receiving ${state.received} of ${state.total} GIFs…`;
}

async function finishSyncIfReady(state) {
  if (!state.sendDone || !state.receiveDone || state.completed) return;
  state.completed = true;
  await refresh();
  els.syncProgressBar.style.width = "100%";
  els.syncStatus.textContent = `Sync complete — ${gifs.length} GIF${gifs.length === 1 ? "" : "s"} saved`;
  showToast("Devices synced");
}

function registerEvents() {
  [els.uploadButton, els.emptyUploadButton, els.dropZone].forEach((el) =>
    el.addEventListener("click", () => els.fileInput.click()),
  );
  els.fileInput.addEventListener("change", () => {
    addFiles(els.fileInput.files);
    els.fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((type) =>
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    }),
  );
  ["dragleave", "drop"].forEach((type) =>
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    }),
  );
  els.dropZone.addEventListener("drop", (event) =>
    addFiles(event.dataTransfer.files),
  );
  els.searchInput.addEventListener("input", render);
  els.sortSelect.addEventListener("change", render);
  els.homeButton.addEventListener("click", () => setView("all"));
  $$(".sidebar>nav .nav-item").forEach((button) =>
    button.addEventListener("click", () => setView(button.dataset.folder)),
  );
  els.newFolderButton.addEventListener("click", () => {
    els.folderNameInput.value = "";
    els.folderDialog.showModal();
    setTimeout(() => els.folderNameInput.focus(), 50);
  });
  els.folderForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const name = els.folderNameInput.value.trim();
    if (!name) return;
    const folder = { id: makeId(), name, createdAt: Date.now() };
    await put(FOLDER_STORE, folder);
    els.folderDialog.close();
    currentView = `folder:${folder.id}`;
    await refresh();
  });
  els.editForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const item = gifs.find((g) => g.id === editingId);
    if (!item) return;
    item.name = els.editNameInput.value.trim() || item.name;
    item.folderId = els.editFolderSelect.value;
    item.updatedAt = Date.now();
    await put(GIF_STORE, item);
    els.editDialog.close();
    await refresh();
    showToast("GIF updated");
  });
  els.deleteGifButton.addEventListener("click", async () => {
    const item = gifs.find((g) => g.id === editingId);
    if (!item || !confirm(`Delete “${item.name}”?`)) return;
    item.deletedAt = Date.now();
    item.updatedAt = item.deletedAt;
    await put(GIF_STORE, item);
    revokeUrl(item.id);
    els.editDialog.close();
    await refresh();
    showToast("GIF deleted");
  });
  els.closeViewerButton.addEventListener("click", closeViewer);
  els.favouriteViewerButton.addEventListener(
    "click",
    () => viewingId && toggleFavourite(viewingId),
  );
  $$(".viewer-controls [data-fit]").forEach((button) =>
    button.addEventListener("click", () => setFit(button.dataset.fit)),
  );
  els.fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await els.viewer.requestFullscreen();
    } catch {
      showToast("Use Add to Home Screen for full-screen on iPad");
    }
  });
  els.backgroundButton.addEventListener("click", () => {
    const modes = ["", "checker", "light"],
      current = modes.findIndex(
        (mode) => mode && els.viewerStage.classList.contains(mode),
      );
    els.viewerStage.className =
      `viewer-stage ${modes[(Math.max(0, current) + 1) % modes.length]}`.trim();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.viewer.hidden) closeViewer();
  });
  els.backupButton.addEventListener("click", exportBackup);
  els.restoreButton.addEventListener("click", () => els.restoreInput.click());
  els.restoreInput.addEventListener("change", () => {
    if (els.restoreInput.files[0]) importBackup(els.restoreInput.files[0]);
    els.restoreInput.value = "";
  });
  els.syncButton.addEventListener("click", openSyncDialog);
  els.closeSyncButton.addEventListener("click", () => els.syncDialog.close());
  els.syncDialog.addEventListener("close", destroySyncConnection);
  els.shareLibraryButton.addEventListener("click", shareLibraryFile);
  els.importLibraryButton.addEventListener("click", () =>
    els.restoreInput.click(),
  );
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });
  els.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    els.installButton.hidden = true;
  });
}
async function init() {
  try {
    db = await openDatabase();
    registerEvents();
    await refresh();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("./sw.js?v=6").catch(() => {});
  } catch (error) {
    console.error(error);
    showToast("Loopbox couldn’t open its saved library");
  }
}
init();
