# Loopbox

A private, local-first GIF library that runs as a static website.

## Features

- Upload and keep GIFs in the browser with IndexedDB
- Full-screen player with fit, fill, and original-size modes
- Search, favourites, folders, sorting, renaming, and deletion
- Restores saved GIFs after closing and reopening
- Offline PWA support
- Export and import a complete library backup for moving between devices

## GitHub Pages

Open the repository's **Settings → Pages**, choose **Deploy from a branch**, then select **main** and **/(root)**.

## Storage note

GIFs are private to the browser on each device. Automatic account-based sync needs a cloud storage project such as Firebase or Supabase. Until that is connected, use **Export backup** and **Import backup** to move the library between devices.
