# Loopbox

A private, local-first GIF library that runs as a static website.

## Features

- Upload and keep GIFs in the browser with IndexedDB
- Full-screen player with fit, fill, and original-size modes
- Search, favourites, folders, sorting, renaming, and deletion
- Restores saved GIFs after closing and reopening
- Offline PWA support
- Two-way device sync using a six-character connection code
- Export and import a complete library backup for moving between devices

## GitHub Pages

Open the repository's **Settings → Pages**, choose **Deploy from a branch**, then select **main** and **/(root)**.

## Storage note

GIFs remain stored privately in each browser. **Sync devices** securely merges two libraries while both devices have Loopbox open. The shared connection code is temporary; once the transfer finishes, the GIFs stay saved on both devices.
