// Demo page: the real task pane, wired to sample emails and a pretend SharePoint.
import { startUI } from "./ui.js";
import { Graph } from "./graph.js";
import { createFakeGraph } from "./fakegraph.js";
import { renderPdf } from "./pdf-client.js";
import { parseEmail, printHtml, escapeHtml as esc } from "./mime.js";
import { SAMPLES } from "./samples.js";
import { CONFIG } from "./config.js";

/* global __LOGO__ */
const cfg = { ...CONFIG, pdfEngine: "client" };
const fake = createFakeGraph({ convert: "fail" });
const graph = new Graph(async () => "demo-token", fake.fetch);
const $ = (id) => document.getElementById(id);
const enc = (s) => new TextEncoder().encode(s);

let current = SAMPLES[0];
let itemChanged = null;
let lastSite = null;

async function renderMailList() {
  const rows = await Promise.all(SAMPLES.map(async (s) => ({ s, p: await parseEmail(enc(s.eml)) })));
  $("mailList").innerHTML = rows.map(({ s, p }) => `
    <button class="mrow ${s === current ? "sel" : ""}" data-id="${s.id}">
      <span class="mfrom">${esc(s.from)}</span><span class="mdate">${esc(p.date.toLocaleDateString("en-AU"))}</span>
      <span class="msub">${esc(p.subject)}</span><span class="mhint">${esc(s.label)}</span>
    </button>`).join("");
  $("mailList").querySelectorAll(".mrow").forEach((b) => (b.onclick = () => {
    current = SAMPLES.find((s) => s.id === b.dataset.id);
    renderMailList(); renderReading(); itemChanged?.();
  }));
}

async function renderReading() {
  const p = await parseEmail(enc(current.eml));
  const f = $("readFrame");
  f.srcdoc = printHtml(p, p.attachments.map((a) => a.name)).replace("width:794px", "width:auto");
}

function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

function renderTree(highlight) {
  if (!lastSite) return;
  const t = fake.tree(lastSite, cfg.inPath);
  $("spSite").textContent = `${lastSite} › ${cfg.library} › ${cfg.inPath.split("/").join(" › ")}`;
  if (!t) { $("spTree").innerHTML = '<div class="empty">No In folder.</div>'; return; }
  const files = [];
  const walk = (n, depth) => n.children.map((c) => {
    const isNew = highlight && c.name === highlight;
    if (!c.folder) files.push(c);
    return `<div class="tn ${c.folder ? "fd" : "fl"} ${isNew ? "new" : ""}" style="padding-left:${depth * 16 + 6}px" ${c.folder ? "" : `data-f="${files.length - 1}"`}>
      <span class="ic">${c.folder ? "▾ 📁" : "📄"}</span><span class="tnm">${esc(c.name)}</span>${c.folder ? "" : `<span class="sz">${fmtSize(c.size)}</span>`}</div>
      ${c.folder ? walk(c, depth + 1) : ""}`;
  }).join("");
  $("spTree").innerHTML = walk(t, 0) || '<div class="empty">Empty - nothing filed yet.</div>';
  $("spTree").querySelectorAll(".fl").forEach((el) => (el.onclick = () => preview(files[el.dataset.f])));
}

async function showPdf(box, bytes) {
  /* global pdfjsLib */
  if (typeof pdfjsLib === "undefined") { box.innerHTML = '<div class="empty">PDF viewer could not load.</div>'; return; }
  box.innerHTML = '<div class="pages"></div>';
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1.4 });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    box.firstChild.appendChild(c);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  }
}

function preview(f) {
  const ext = f.name.split(".").pop().toLowerCase();
  const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
  $("pvName").textContent = f.name;
  const box = $("pvBody");
  if (ext === "pdf") showPdf(box, f.bytes).catch((e) => { box.innerHTML = `<div class="empty">Couldn't show PDF: ${esc(e.message)}</div>`; });
  else if (["jpg", "jpeg", "png"].includes(ext)) box.innerHTML = `<img src="${URL.createObjectURL(new Blob([f.bytes], { type: types[ext] }))}" alt="">`;
  else if (["csv", "eml", "txt"].includes(ext)) box.innerHTML = `<pre>${esc(new TextDecoder().decode(f.bytes).slice(0, 20000))}</pre>`;
  else box.innerHTML = '<div class="empty">No preview for this file type.</div>';
  $("pv").classList.remove("hidden");
  $("pv").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("pvClose").onclick = () => $("pv").classList.add("hidden");

renderMailList();
renderReading();

startUI({
  root: $("pane"),
  cfg,
  logoSrc: __LOGO__,
  testBuild: true,
  graph,
  renderPdf,
  host: {
    async load() { return { mime: enc(current.eml), fallbackDate: new Date() }; },
    onItemChanged(cb) { itemChanged = cb; },
  },
  onFiled(res, target) {
    lastSite = target.site.displayName;
    renderTree(res.folder.name);
    $("spCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
});
