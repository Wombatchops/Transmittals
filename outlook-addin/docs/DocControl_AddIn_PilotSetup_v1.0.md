# Doc Control Outlook add-in: pilot setup v1.0

**Goal:** get the "Send to Doc Control" button working in **Mark's Outlook only**, test it on real emails, refine, and then roll it out to the team.

| Who | Step | Time |
|---|---|---|
| Mark | A. Turn on GitHub Pages hosting | 2 min |
| IT provider | B. Register the app in Microsoft Entra and grant admin consent | 10 min |
| Mark (or me) | C. Add the client ID | 1 min |
| Mark | D. Install the add-in for yourself only | 5 min |
| Mark | E. Test with the checklist | 30 min |
| IT provider | F. Later: roll out to the team | 10 min, then up to 24 h to appear |

---

## A. Turn on hosting (Mark)

The add-in's files are hosted free on GitHub Pages from the public repo `Wombatchops/Transmittals`.

1. Go to **github.com/Wombatchops/Transmittals → Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Go to **Actions → "Outlook add-in - build and publish" → Run workflow**.
4. After about 2 minutes, https://wombatchops.github.io/Transmittals/ shows a small page listing the manifest and the demo.

## B. App registration (IT provider)

This lets the add-in act as the signed-in person on SharePoint. It can only reach SharePoint sites that person can already open. That is how the "ask the project manager for access" message works.

1. Open **Microsoft Entra admin center → Identity → Applications → App registrations → New registration**.
   - Name: `Doc Control Outlook add-in`
   - Supported account types: **Accounts in this organizational directory only (single tenant)**
   - Redirect URI: leave blank for now. Then **Register**.
2. Open **Authentication → Add a platform → Single-page application**. Add both of these redirect URIs exactly:
   - `brk-multihub://wombatchops.github.io`
   - `https://wombatchops.github.io/Transmittals/taskpane.html`
3. Open **API permissions → Add a permission → Microsoft Graph → Delegated permissions**. Add:
   - `Sites.ReadWrite.All` to find the job site and save files
   - `Mail.Read` as a backup way to read the selected email
   - `User.Read`, `openid`, `profile`, `offline_access` (standard sign-in)
4. Click **Grant admin consent for Design Process**. Every permission should show a green tick.
5. Copy the **Application (client) ID** from **Overview** and send it to Mark.

No client secret or certificate is needed. Sign-in uses Outlook's built-in "nested app authentication" (Microsoft's current method for Office add-ins).

## C. Add the client ID (Mark, or ask Claude)

Either:
- Edit `outlook-addin/addin.config.json` in the repo and paste the ID into `"clientId"`, **or**
- In GitHub go to **Settings → Secrets and variables → Actions → Variables → New repository variable**, name it `DC_CLIENT_ID`, and paste the ID as the value. Then go to **Actions → Run workflow**.

The client ID isn't a secret. It identifies the app and can't be used without a Design Process sign-in.

## D. Install for yourself only (Mark)

1. Download the manifest: https://wombatchops.github.io/Transmittals/DocControl_manifest_v1.0.xml
2. Open **Outlook on the web** (or new Outlook) and go to https://aka.ms/olksideload. Choose **My add-ins → Custom Addins → Add a custom add-in → Add from file**, then pick the downloaded file.
3. Open any email. The **Doc Control** button appears:
   - **New Outlook / web:** in the ribbon, or under **Apps** / the **…** menu on the message
   - **Classic Outlook (Windows):** Home ribbon, "Design Process" group. It can take a few minutes to show up after installing on the web.
4. The first time you use it, Outlook may ask you to sign in or accept permissions once.

If step 2 is blocked ("custom add-ins not allowed"), ask IT to use step F but assign it to **Mark only**.

## E. Pilot test checklist

Use the **000000 Test** site (job `000000`) first, then a real job.

- [ ] Email with attachments: check the folder, the `.eml`, the PDF and every attachment.
- [ ] Email with a signature logo or pasted screenshot: it should appear in the PDF but **not** as a separate file.
- [ ] Sub job number filled in: folder reads `YYYYMMDD SUB Subject`.
- [ ] Same email twice: the second folder gets ` (2)`.
- [ ] Wrong or no-access job number: you get the "ask the project manager" message.
- [ ] Job number used by two sites (e.g. 185301): you're asked to pick one.
- [ ] Large email (over 2 MB): PDF still created.
- [ ] Email in a shared mailbox (if you use one).
- [ ] Classic Outlook, new Outlook and Outlook on the web each work.
- [ ] **PDF quality:** does it look right? Is the text selectable? The step list shows "(Microsoft 365)" or "(in-browser)" for each PDF.

Send back anything that looks wrong. Screenshots of the pane and the folder are ideal.

## How changes reach you during the pilot

- **Code changes** (screens, naming, PDF) go live when they're pushed to the repo. That takes about 2 minutes to build, plus up to 10 minutes for GitHub's cache. Close and reopen the pane to pick them up. **No reinstall.**
- **Manifest changes** (button name, icon, permissions) need the manifest re-added. These will be rare and flagged with a new manifest version (`_v1.1`, …).

## F. Roll out to the team (IT provider, after the pilot)

**Microsoft 365 admin center → Settings → Integrated apps → Upload custom apps**

1. App type: **Office Add-in**. Choose to **provide the link to the manifest file**:
   `https://wombatchops.github.io/Transmittals/DocControl_manifest_v1.0.xml`
2. Assign it to the users or group who should have it, or to **Entire organization**.
3. Deploy. It can take **up to 24 hours** to appear for everyone. Users don't need to install anything.

## Known limits (v1.0)

- **No right-click menu.** Microsoft doesn't allow it in this type of add-in. Use the button or the "…" menu instead.
- **One email at a time.**
- **The email is saved as `.eml`, not `.msg`.** Microsoft only hands add-ins the `.eml` form. Outlook opens it normally.
- **PDF:** first choice is Microsoft 365's own conversion. If that fails, the add-in makes the PDF in the browser instead, and the step shows "check". In that case the PDF is a picture of the email, so its text isn't selectable. Which one we get in our tenant is one of the things the pilot checks.
- **Outlook versions:** Microsoft 365 Outlook 2409 or later on Windows, Mac 16.89+, new Outlook and Outlook on the web. Older builds show "this version of Outlook can't sign in".
- **Hosting:** the repo is public, so the add-in code is visible. It holds no passwords, client data or files.

## Troubleshooting

| Message | Meaning / fix |
|---|---|
| Not set up yet | Client ID missing. Do step C. |
| This version of Outlook can't sign in to add-ins | Update Microsoft 365 apps, or use new Outlook / the web. |
| Job … wasn't found in SharePoint, or you don't have access | Wrong number, or no access to that job site. Ask the project manager. |
| … has no "Project" document library / "04 Document Control/02 Transmittals" folder | The job site isn't set up to the standard layout. The PM should fix the site. |
| AADSTS… error on sign-in | The app registration or consent (step B) isn't complete. Send the code to IT. |
