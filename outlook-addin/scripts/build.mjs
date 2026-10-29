// Builds dist/ (what GitHub Pages hosts) and the demo page.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "addin.config.json"), "utf8"));
const base = (process.env.DC_BASE_URL || cfg.baseUrl).replace(/\/$/, "");
if (process.env.DC_CLIENT_ID) cfg.clientId = process.env.DC_CLIENT_ID;
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const dist = path.join(root, "dist");
const v = cfg.version;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "assets"), { recursive: true });

const common = {
  bundle: true, minify: true, format: "iife", target: ["es2020"], legalComments: "none",
  define: { __DC_CONFIG__: JSON.stringify({ ...cfg, baseUrl: base }) },
  external: ["canvg", "dompurify"],
  logLevel: "warning",
};

// 1. The add-in
await build({ ...common, entryPoints: [path.join(root, "src/taskpane.js")], outfile: path.join(dist, "taskpane.js") });
fs.copyFileSync(path.join(root, "src/taskpane.css"), path.join(dist, "taskpane.css"));
for (const f of ["taskpane.html", "commands.html"]) {
  fs.writeFileSync(path.join(dist, f), fs.readFileSync(path.join(root, "src", f), "utf8").replaceAll("__BUILD__", stamp));
}
for (const f of fs.readdirSync(path.join(root, "assets"))) fs.copyFileSync(path.join(root, "assets", f), path.join(dist, "assets", f));

// 2. Manifest (the file installed in Outlook)
const manifestName = `DocControl_manifest_v${v}.xml`;
const manifest = fs.readFileSync(path.join(root, "manifest", manifestName), "utf8").replaceAll("__BASE__", base);
fs.writeFileSync(path.join(dist, manifestName), manifest);

// 3. Demo page (single file, sample data, pretend SharePoint)
const logo = "data:image/png;base64," + fs.readFileSync(path.join(root, "assets/DesignProcess_logo_white_v1.png")).toString("base64");
const demoJs = await build({ ...common, entryPoints: [path.join(root, "src/demo.js")], write: false,
  define: { ...common.define, __LOGO__: JSON.stringify(logo) } });
const demoHtml = fs.readFileSync(path.join(root, "src/demo.html"), "utf8")
  .replace("__CSS__", () => fs.readFileSync(path.join(root, "src/taskpane.css"), "utf8"))
  .replace("__JS__", () => demoJs.outputFiles[0].text.replaceAll("</script", "<\\/script"))
  .replaceAll("__LOGO__", logo).replaceAll("__VERSION__", v);
const demoName = `DocControl_Demo_v${v}.html`;
fs.writeFileSync(path.join(dist, demoName), demoHtml);

// 4. Landing page so the site root isn't a 404
fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html><meta charset="utf-8"><title>Doc Control add-in</title>
<body style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1c2127">
<h1 style="color:#1f3a5f">Doc Control - Outlook add-in v${v}</h1>
<p>Hosted files for the Design Process "Send to Doc Control" Outlook add-in.</p>
<ul><li><a href="${manifestName}">${manifestName}</a> - manifest for installing the add-in</li>
<li><a href="${demoName}">${demoName}</a> - demo with sample emails</li></ul>
<p style="color:#7c848d;font-size:12px">Build ${stamp}${cfg.clientId ? "" : " - not yet configured (no client ID)"}</p></body>`);
fs.writeFileSync(path.join(dist, ".nojekyll"), "");

console.log(`built v${v} (${stamp}) base=${base} clientId=${cfg.clientId ? "set" : "MISSING"}`);
for (const f of fs.readdirSync(dist)) { const st = fs.statSync(path.join(dist, f)); if (st.isFile()) console.log(`  ${f}  ${(st.size / 1024).toFixed(0)} KB`); }
