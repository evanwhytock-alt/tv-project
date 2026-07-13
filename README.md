# Loopbox

A private, local-first GIF library with optional Google account sync.

## Features

- Upload and keep GIFs in the browser with IndexedDB
- Full-screen player with fit, fill, and original-size modes
- Search, favourites, folders, sorting, renaming, and deletion
- Restores saved GIFs after closing and reopening
- Offline PWA support
- Automatic cross-device sync after signing in with Google
- Export and import a complete library backup for moving between devices

## GitHub Pages

Open the repository's **Settings → Pages**, choose **Deploy from a branch**, then select **main** and **/(root)**.

## Google sync setup

1. Create a Firebase project and add a Web app.
2. In **Authentication → Sign-in method**, enable Google.
3. Add `evanwhytock-alt.github.io` to Authentication's authorized domains.
4. Create a Realtime Database and use these rules:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    }
  }
}
```

5. Copy the public Firebase Web configuration into `firebase-config.js`.

GIFs still remain in each browser for offline use. Signing out does not delete
the device's local library.
