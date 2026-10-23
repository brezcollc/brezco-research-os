# TikTok editor

Edit TikToks from your phone: record → upload to Google Drive → send Claude the link → get the edited video back.

## How to use it (every time)

1. Record your video on your phone.
2. In the **Google Drive** app: **+** → **Upload** → pick the video.
3. On the uploaded video: **⋯** → **Share** → **Manage access** → General access: **Anyone with the link**.
   Copy the link.
4. Open **Claude → Code**, start a new cloud session on the **brezco-research-os** repo
   (same environment as before), and send:

   ```
   /tiktok-edit <paste the Drive link>
   ```

   (Or just say: *"Use the tiktok-editor folder and edit this video: <link>"*.)
5. Wait ~10–15 minutes. Your laptop/phone can sleep — it runs in the cloud.
6. Save the video Claude sends back to your camera roll and post it.

Tip: setting your whole Drive videos folder to "Anyone with the link" once means you can skip step 3.

## If something goes wrong
- **"Drive returned a web page"** → the video isn't shared with "Anyone with the link" yet (step 3).
- **Download blocked / 403** → the cloud environment's network setting was reset. At claude.ai/code, tap the
  cloud button above the message box → gear on your environment → Network access **Custom**, allowed domains
  `drive.google.com` and `drive.usercontent.google.com`, keep "include default list" checked → Save.
- Anything else: just tell Claude what looks wrong (e.g. "the lips are out of sync at 0:40").

## What's in here (for Claude)
See `CLAUDE.md` — the full pipeline, the approved style, and lessons learned.
