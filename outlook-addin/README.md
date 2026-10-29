# Doc Control - Outlook add-in

"Send to Doc Control" button for Outlook. It files the selected email into the job's SharePoint site, at
`<job site> / Project / 04 Document Control / 02 Transmittals / In / YYYYMMDD [sub job] Subject`.
That folder gets the email (.eml), a PDF of it, and its attachments. Embedded images are printed in the PDF and not saved separately.

- **Set up / pilot / rollout:** [docs/DocControl_AddIn_PilotSetup_v1.0.md](docs/DocControl_AddIn_PilotSetup_v1.0.md)
- **Demo (sample data, no sign-in):** https://wombatchops.github.io/Transmittals/DocControl_Demo_v1.0.html
- **Manifest:** https://wombatchops.github.io/Transmittals/DocControl_manifest_v1.0.xml

| Path | What |
|---|---|
| `addin.config.json` | Version, client ID, tenant, hosting URL, library name, In-folder path, PDF engine (`graph` or `client`) |
| `manifest/DocControl_manifest_vX.xml` | Outlook manifest template (`__BASE__` filled at build) |
| `src/naming.js` | Folder and file naming rules |
| `src/mime.js` | Reads the email; decides embedded vs attached images; builds the print copy |
| `src/graph.js` | SharePoint calls through Microsoft Graph |
| `src/filer.js` | The filing steps |
| `src/ui.js` | Task pane screen (Design Process tool standard) |
| `src/fakegraph.js`, `src/samples.js`, `src/demo.*` | Pretend SharePoint and sample emails for the demo and tests |

```
npm ci
npm test               # logic tests against the pretend SharePoint
npm run test:browser   # builds, then drives the demo + task pane in Chromium
npm run build          # dist/ = what GitHub Pages hosts
```

Pushing to `main` runs `.github/workflows/addin-pages.yml`: tests, build, manifest check, publish to GitHub Pages.

Releases: bump `version` in `addin.config.json` and `VERSION_HISTORY` in `src/config.js`. Copy the manifest to the new `_vX` **only if** the manifest itself changes (button, icon, permissions); otherwise users get the new code without reinstalling.
