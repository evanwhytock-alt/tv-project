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
  syncButtonText: $("#syncButtonText"),
  syncDialog: $("#syncDialog"),
  closeSyncButton: $("#closeSyncButton"),
  cloudSetup: $("#cloudSetup"),
  cloudConnected: $("#cloudConnected"),
  googleSignInButton: $("#googleSignInButton"),
  cloudStatus: $("#cloudStatus"),
  cloudAccountName: $("#cloudAccountName"),
  cloudAvatar: $("#cloudAvatar"),
  cloudCheck: $("#cloudCheck"),
  syncNowButton: $("#syncNowButton"),
  disconnectCloudButton: $("#disconnectCloudButton"),
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
const FIREBASE_CONFIG = window.LOOPBOX_FIREBASE_CONFIG || {};
const CLOUD_CHUNK_SIZE = 512000;
let cloudAuth = null,
  cloudUser = null,
  cloudApplying = false,
  cloudFlushTimer = null,
  cloudPollTimer = null,
  cloudSyncPromise = null;
const cloudGifQueue = new Map(),
  cloudFolderQueue = new Map(),
  cloudBlobCache = new Map();

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
    request.onsuccess = () => {
      if (!cloudApplying) queueCloudRecord(storeName, value);
      resolve(request.result);
    };
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
    showToast("Backup imported");
  } catch {
    showToast("That backup file didn’t work");
  }
}

function openSyncDialog() {
  renderCloudUi();
  setCloudStatus(
    hasCloudConfig()
      ? ""
      : "Google sign-in needs the Loopbox Firebase project connected first.",
    !hasCloudConfig(),
  );
  els.syncDialog.showModal();
}

function hasCloudConfig() {
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
      FIREBASE_CONFIG.authDomain &&
      FIREBASE_CONFIG.databaseURL &&
      FIREBASE_CONFIG.projectId,
  );
}

function setCloudStatus(message, error = false) {
  els.cloudStatus.hidden = !message;
  els.cloudStatus.textContent = message;
  els.cloudStatus.classList.toggle("error", error);
}

function renderCloudUi() {
  const connected = Boolean(cloudUser);
  els.cloudSetup.hidden = connected;
  els.cloudConnected.hidden = !connected;
  els.syncButton.classList.toggle("cloud-on", connected);
  els.syncButtonText.textContent = connected ? "Synced" : "Sign in";
  els.syncButton.setAttribute(
    "aria-label",
    connected ? "Open Google sync" : "Sign in to sync",
  );
  if (!connected) return;
  els.cloudAccountName.textContent =
    cloudUser.email || cloudUser.displayName || "Google account";
  const photo = cloudUser.photoURL;
  els.cloudAvatar.hidden = !photo;
  els.cloudCheck.hidden = Boolean(photo);
  if (photo) els.cloudAvatar.src = photo;
}

async function signInWithGoogle() {
  if (!hasCloudConfig())
    return setCloudStatus(
      "Google sign-in needs the Loopbox Firebase project connected first.",
      true,
    );
  if (!cloudAuth)
    return setCloudStatus("Google sign-in couldn’t load. Check your internet.", true);
  els.googleSignInButton.disabled = true;
  setCloudStatus("Opening Google sign-in…");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await cloudAuth.signInWithPopup(provider);
  } catch (error) {
    if (error?.code === "auth/popup-closed-by-user") setCloudStatus("");
    else if (error?.code === "auth/unauthorized-domain")
      setCloudStatus("This Loopbox website still needs to be allowed in Firebase.", true);
    else {
      console.error(error);
      setCloudStatus("Google sign-in didn’t work. Please try again.", true);
    }
  } finally {
    els.googleSignInButton.disabled = false;
  }
}

async function signOutCloud() {
  if (cloudAuth) await cloudAuth.signOut();
  setCloudStatus("Signed out on this device.");
}

async function firebaseData(path, options = {}, retry = true) {
  if (!cloudUser) throw new Error("Google sync is disconnected");
  const token = await cloudUser.getIdToken(!retry);
  const root = String(FIREBASE_CONFIG.databaseURL).replace(/\/$/, "");
  const response = await fetch(
    `${root}/${path}.json?auth=${encodeURIComponent(token)}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    },
  );
  if (response.status === 401 && retry) return firebaseData(path, options, false);
  if (!response.ok) throw new Error(`Cloud request failed (${response.status})`);
  if (response.status === 204) return null;
  return response.json();
}

function queueCloudRecord(storeName, value) {
  if (!cloudUser || !value?.id) return;
  if (storeName === GIF_STORE) cloudGifQueue.set(value.id, value);
  if (storeName === FOLDER_STORE) cloudFolderQueue.set(value.id, value);
  clearTimeout(cloudFlushTimer);
  cloudFlushTimer = setTimeout(() => {
    flushCloudQueue().catch((error) => {
      console.error(error);
      setCloudStatus("A change is waiting to sync. We’ll retry.", true);
    });
  }, 750);
}

async function blobToCloudChunks(blob, id) {
  const cached = cloudBlobCache.get(id);
  if (cached?.size === blob.size) return cached.chunks;
  const dataUrl = await blobToDataUrl(blob);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const chunks = {};
  for (let offset = 0, index = 0; offset < base64.length; index += 1) {
    chunks[index] = base64.slice(offset, offset + CLOUD_CHUNK_SIZE);
    offset += CLOUD_CHUNK_SIZE;
  }
  cloudBlobCache.set(id, { size: blob.size, chunks });
  return chunks;
}

async function uploadCloudGif(record) {
  const { blob, ...metadata } = record;
  let payload = metadata;
  if (!record.deletedAt) {
    if (!(blob instanceof Blob)) throw new Error("A GIF is missing its file data");
    payload = {
      ...metadata,
      mime: blob.type || "image/gif",
      chunks: await blobToCloudChunks(blob, record.id),
    };
  } else cloudBlobCache.delete(record.id);
  await firebaseData(
    `users/${cloudUser.uid}/gifs/${encodeURIComponent(record.id)}`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
}

async function flushCloudQueue() {
  if (!cloudUser || !hasCloudConfig()) return;
  clearTimeout(cloudFlushTimer);
  cloudFlushTimer = null;
  const gifRecords = [...cloudGifQueue.values()];
  const folderRecords = [...cloudFolderQueue.values()];
  cloudGifQueue.clear();
  cloudFolderQueue.clear();
  for (const folder of folderRecords)
    await firebaseData(
      `users/${cloudUser.uid}/folders/${encodeURIComponent(folder.id)}`,
      { method: "PUT", body: JSON.stringify(folder) },
    );
  for (const gif of gifRecords) await uploadCloudGif(gif);
}

function cloudChunksToBlob(chunks, mime = "image/gif") {
  const ordered = (Array.isArray(chunks)
    ? chunks
    : Object.keys(chunks || {})
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => chunks[key])
  ).filter(Boolean);
  const parts = ordered.map((chunk) => {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  });
  return new Blob(parts, { type: mime });
}

function cloudRecordTime(record) {
  return record?.updatedAt || record?.createdAt || 0;
}

async function runCloudSync() {
  if (!cloudUser || !hasCloudConfig()) return;
  setCloudStatus("Syncing changes…");
  await flushCloudQueue();
  const remote =
    (await firebaseData(`users/${cloudUser.uid}`, { method: "GET" })) || {};
  const localGifs = await getAll(GIF_STORE);
  const localFolders = await getAll(FOLDER_STORE);
  const localGifMap = new Map(localGifs.map((record) => [record.id, record]));
  const localFolderMap = new Map(
    localFolders.map((record) => [record.id, record]),
  );
  const remoteGifs = Object.values(remote.gifs || {});
  const remoteFolders = Object.values(remote.folders || {});
  cloudApplying = true;
  try {
    for (const folder of remoteFolders) {
      const local = localFolderMap.get(folder.id);
      if (!local || cloudRecordTime(folder) > cloudRecordTime(local))
        await put(FOLDER_STORE, folder);
    }
    for (const remoteGif of remoteGifs) {
      const local = localGifMap.get(remoteGif.id);
      if (local && cloudRecordTime(local) > cloudRecordTime(remoteGif)) continue;
      const { chunks, mime, ...metadata } = remoteGif;
      let incoming;
      if (remoteGif.deletedAt)
        incoming = {
          ...(local || {}),
          ...metadata,
          deletedAt: remoteGif.deletedAt,
        };
      else if (chunks)
        incoming = {
          ...metadata,
          blob: cloudChunksToBlob(chunks, mime),
          size: metadata.size || 0,
        };
      if (incoming) {
        revokeUrl(incoming.id);
        await put(GIF_STORE, incoming);
      }
    }
  } finally {
    cloudApplying = false;
  }
  const remoteGifMap = new Map(remoteGifs.map((record) => [record.id, record]));
  const remoteFolderMap = new Map(
    remoteFolders.map((record) => [record.id, record]),
  );
  for (const local of await getAll(GIF_STORE)) {
    const remoteRecord = remoteGifMap.get(local.id);
    if (!remoteRecord || cloudRecordTime(local) > cloudRecordTime(remoteRecord))
      queueCloudRecord(GIF_STORE, local);
  }
  for (const local of await getAll(FOLDER_STORE)) {
    const remoteRecord = remoteFolderMap.get(local.id);
    if (!remoteRecord || cloudRecordTime(local) > cloudRecordTime(remoteRecord))
      queueCloudRecord(FOLDER_STORE, local);
  }
  await flushCloudQueue();
  await refresh();
  setCloudStatus(`Up to date — ${gifs.length} GIF${gifs.length === 1 ? "" : "s"}`);
}

async function syncCloudNow() {
  if (cloudSyncPromise) return cloudSyncPromise;
  cloudSyncPromise = runCloudSync()
    .catch((error) => {
      console.error(error);
      setCloudStatus(
        navigator.onLine
          ? "Couldn’t reach Google sync. We’ll retry."
          : "Offline — changes will sync when you reconnect.",
        true,
      );
      throw error;
    })
    .finally(() => {
      cloudSyncPromise = null;
    });
  return cloudSyncPromise;
}

function startCloudPolling() {
  clearInterval(cloudPollTimer);
  if (!cloudUser) return;
  cloudPollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine)
      syncCloudNow().catch(() => {});
  }, 12000);
}

function handleCloudUser(user) {
  cloudUser = user;
  renderCloudUi();
  clearInterval(cloudPollTimer);
  if (!user) {
    cloudGifQueue.clear();
    cloudFolderQueue.clear();
    return;
  }
  startCloudPolling();
  syncCloudNow()
    .then(() => showToast("Google sync is on"))
    .catch(() => {});
}

async function initCloudAuth() {
  if (!hasCloudConfig() || !window.firebase) {
    renderCloudUi();
    return;
  }
  try {
    const app = firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(FIREBASE_CONFIG);
    cloudAuth = app.auth();
    await cloudAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    cloudAuth.onAuthStateChanged(handleCloudUser);
  } catch (error) {
    console.error(error);
    setCloudStatus("Google sign-in couldn’t start.", true);
  }
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
    const now = Date.now();
    const folder = { id: makeId(), name, createdAt: now, updatedAt: now };
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
  els.googleSignInButton.addEventListener("click", signInWithGoogle);
  els.syncNowButton.addEventListener("click", () =>
    syncCloudNow().catch(() => {}),
  );
  els.disconnectCloudButton.addEventListener("click", signOutCloud);
  window.addEventListener("online", () => syncCloudNow().catch(() => {}));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && cloudUser)
      syncCloudNow().catch(() => {});
  });
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
    await initCloudAuth();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("./sw.js?v=8").catch(() => {});
  } catch (error) {
    console.error(error);
    showToast("Loopbox couldn’t open its saved library");
  }
}
init();
