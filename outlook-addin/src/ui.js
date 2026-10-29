// Task pane screen. Host-agnostic: the real add-in and the demo both call startUI().
import { parseEmail, sentText, escapeHtml as esc } from "./mime.js";
import { folderName, cleanJob, suggestJob } from "./naming.js";
import { findJob, findInFolder, fileEmail, FriendlyError } from "./filer.js";
import { VERSION_HISTORY } from "./config.js";

const LS_KEY = "dc.recentJobs.v1";
const ls = {
  get() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; } },
  add(job, site) {
    try {
      const list = ls.get().filter((r) => !(r.job === job && r.siteId === site.id));
      list.unshift({ job, siteId: site.id, name: site.displayName });
      localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 6)));
    } catch { /* storage blocked - ignore */ }
  },
};

const STEP_LABELS = { folder: "Create folder", email: "Save email", attachments: "Save attachments", pdf: "Save PDF" };
const STATE_CHIP = { wait: ["st-na", "wait"], run: ["st-info", "…"], ok: ["st-ok", "done"], warn: ["st-wait", "check"], bad: ["st-bad", "failed"] };

/**
 * env: {
 *   root, cfg, logoSrc, testBuild,
 *   graph: Graph | null, setupProblem: string | null,
 *   host: { load(graph) -> {mime, fallbackDate}, onItemChanged(cb) },
 *   renderPdf(html) -> Uint8Array,
 *   onFiled(result, target)   (optional, demo uses it)
 * }
 */
export function startUI(env) {
  const { root, cfg } = env;
  const S = { email: null, mime: null, sites: [], site: null, job: "", busy: false, done: false };

  root.innerHTML = `
  <div class="dc">
    <header class="dp-head">
      <img class="logo" src="${env.logoSrc}" alt="Design Process">
      <span class="divider"></span>
      <div class="dp-title">
        <div class="dp-title-row"><h1>Doc Control</h1>
          <button class="ver-btn" id="verBtn" title="Version history">v${esc(cfg.version)}</button>
          ${env.testBuild ? '<span class="test-pill">Pilot</span>' : ""}</div>
        <div class="sub">Send email to the job's SharePoint</div>
      </div>
    </header>
    <main>
      <div class="card vh hidden" id="vh"></div>
      <div id="setup" class="banner bad hidden"></div>
      <div class="card" id="mailCard"><h3>Email</h3><div id="mail"><span class="spin"></span> Reading email…</div></div>
      <div class="card" id="jobCard">
        <h3>Job</h3>
        <div class="field">
          <label for="job">Head job number</label>
          <div class="row"><input class="txt" id="job" autocomplete="off" spellcheck="false" placeholder="e.g. 185501">
            <button class="btn btn-steel" id="find">Find</button></div>
          <div class="chips" id="chips"></div>
        </div>
        <div id="siteArea"></div>
        <div class="field">
          <label for="sub">Sub job number <span class="opt">(optional)</span></label>
          <input class="txt" id="sub" autocomplete="off" spellcheck="false" placeholder="e.g. 02">
          <span class="hint">Added to the folder name after the date.</span>
        </div>
      </div>
      <div class="card" id="destCard">
        <h3>Will be saved as</h3>
        <div class="preview" id="preview">—</div>
        <div class="path" id="path"></div>
      </div>
      <button class="btn btn-amber btn-block" id="go" disabled>Send to Doc Control</button>
      <div class="card hidden" id="progCard"><h3>Progress</h3><ul class="steps" id="steps"></ul></div>
      <div id="result"></div>
    </main>
    <footer>DocControl Outlook add-in v${esc(cfg.version)}${env.testBuild ? " · pilot" : ""}</footer>
  </div>`;

  const $ = (id) => root.querySelector("#" + id);
  const jobIn = $("job"), subIn = $("sub"), goBtn = $("go");

  // ---------------------------------------------------------------- version history
  $("vh").innerHTML = VERSION_HISTORY.map((h, i) =>
    `<div><span class="ver ${i === 0 ? "cur" : ""}">v${esc(h.v)}</span><span class="dt">${esc(h.date)}</span>
     <ul>${h.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`).join("");
  $("verBtn").onclick = () => $("vh").classList.toggle("hidden");

  if (env.setupProblem) {
    $("setup").innerHTML = env.setupProblem;
    $("setup").classList.remove("hidden");
  }

  // ---------------------------------------------------------------- email
  async function loadEmail() {
    S.email = null; S.mime = null; S.done = false;
    $("mail").innerHTML = '<span class="spin"></span> Reading email…';
    $("result").innerHTML = ""; $("progCard").classList.add("hidden");
    try {
      const { mime, fallbackDate } = await env.host.load(env.graph);
      S.mime = mime;
      S.email = await parseEmail(mime, fallbackDate);
      const e = S.email;
      const att = e.attachments.length, img = e.inline.size;
      $("mail").innerHTML = `<div class="mail-subj">${esc(e.subject || "(no subject)")}</div>
        <div class="mail-meta">${esc(e.from)}<br>${esc(sentText(e.date))}${e.dateFromEmail ? "" : " (no date in email - received date used)"}<br>
        ${att} attachment${att === 1 ? "" : "s"} to save${img ? ` · ${img} embedded image${img === 1 ? "" : "s"} (PDF only)` : ""}</div>`;
      const sug = suggestJob(e.subject);
      renderChips(sug);
    } catch (err) {
      $("mail").innerHTML = `<div class="banner bad">Couldn't read this email: ${esc(err.message)}</div>`;
    }
    refresh();
  }

  function renderChips(suggest) {
    const recent = ls.get();
    const chips = [];
    if (suggest && !recent.some((r) => r.job === suggest)) chips.push(`<button class="chip suggest" data-job="${esc(suggest)}" title="Job number found in the subject">${esc(suggest)} · from subject</button>`);
    for (const r of recent) chips.push(`<button class="chip" data-job="${esc(r.job)}" data-site="${esc(r.siteId)}" title="${esc(r.name)}">${esc(r.job)} · ${esc(shorten(r.name, 22))}</button>`);
    $("chips").innerHTML = chips.join("");
    $("chips").querySelectorAll(".chip").forEach((b) => (b.onclick = () => { jobIn.value = b.dataset.job; find(b.dataset.site); }));
  }
  const shorten = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

  // ---------------------------------------------------------------- job lookup
  async function find(preferSiteId) {
    const job = cleanJob(jobIn.value);
    jobIn.value = job;
    S.sites = []; S.site = null; S.job = job; S.done = false;
    $("result").innerHTML = "";
    if (!job) { $("siteArea").innerHTML = ""; refresh(); return; }
    if (!env.graph) { refresh(); return; }
    $("siteArea").innerHTML = `<div class="hint" style="margin-top:6px"><span class="spin"></span> Looking for job ${esc(job)}…</div>`;
    try {
      S.sites = await findJob(env.graph, job);
      if (S.job !== job) return; // user typed something else meanwhile
      S.site = S.sites.find((s) => s.id === preferSiteId) || (S.sites.length === 1 ? S.sites[0] : null);
      renderSites();
    } catch (err) {
      if (S.job !== job) return;
      $("siteArea").innerHTML = `<div class="banner bad" style="margin-top:6px">${esc(err instanceof FriendlyError ? err.message : "Couldn't search SharePoint: " + err.message)}</div>`;
    }
    refresh();
  }

  function renderSites() {
    const many = S.sites.length > 1;
    $("siteArea").innerHTML = `${many ? `<div class="hint" style="margin-top:6px">${S.sites.length} sites start with ${esc(S.job)} - pick one:</div>` : ""}
      <div class="sites">${S.sites.map((s) => `
        <label class="site ${S.site?.id === s.id ? "sel" : ""}">
          ${many ? `<input type="radio" name="site" value="${esc(s.id)}" ${S.site?.id === s.id ? "checked" : ""}>` : '<span class="st st-ok">found</span>'}
          <span><span class="nm">${esc(s.displayName)}</span><br><span class="url">${esc(decodeURI(s.webUrl || ""))}</span></span>
        </label>`).join("")}</div>`;
    $("siteArea").querySelectorAll("input[name=site]").forEach((r) => (r.onchange = () => {
      S.site = S.sites.find((s) => s.id === r.value); S.done = false; renderSites(); refresh();
    }));
  }

  // ---------------------------------------------------------------- preview + button
  function refresh() {
    const e = S.email;
    if (e) {
      $("preview").textContent = folderName(e.date, e.subject, subIn.value);
    }
    $("path").textContent = S.site
      ? `${S.site.displayName} › ${cfg.library} › ${cfg.inPath.split("/").join(" › ")}`
      : `<job site> › ${cfg.library} › ${cfg.inPath.split("/").join(" › ")}`;
    goBtn.disabled = !(e && S.site && env.graph && !S.busy && !S.done);
    goBtn.textContent = S.done ? "Sent ✓" : S.busy ? "Sending…" : "Send to Doc Control";
  }

  // ---------------------------------------------------------------- filing
  function stepsUI() {
    const order = ["folder", "email", "attachments", "pdf"];
    $("steps").innerHTML = order.map((k) => `<li id="st-${k}"><span class="st st-na">wait</span><span>${STEP_LABELS[k]}<span class="det"></span></span></li>`).join("");
    $("progCard").classList.remove("hidden");
  }
  function step(k, state, detail) {
    const li = $("st-" + k); if (!li) return;
    const [cls, txt] = STATE_CHIP[state] || STATE_CHIP.wait;
    li.querySelector(".st").className = "st " + cls;
    li.querySelector(".st").textContent = txt;
    if (detail != null) li.querySelector(".det").textContent = detail;
  }

  async function go() {
    if (goBtn.disabled) return;
    S.busy = true; refresh();
    $("result").innerHTML = "";
    stepsUI();
    let current = "folder";
    try {
      const target = await findInFolder(env.graph, S.site, cfg);
      const res = await fileEmail({
        graph: env.graph, target, parsed: S.email, mime: S.mime, subJob: subIn.value, cfg,
        renderPdf: env.renderPdf, onStep: (k, st, d) => { current = k; step(k, st, d); },
      });
      ls.add(S.job, S.site);
      S.done = true;
      const url = res.folder.webUrl;
      $("result").innerHTML = `<div class="banner ${res.warnings.length ? "" : "ok"}">
        <b>Filed to ${esc(S.site.displayName)}</b><br>${esc(res.folder.name)}<br>
        ${res.files.length} file${res.files.length === 1 ? "" : "s"} saved.
        ${res.warnings.length ? `<ul>${res.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
        ${url ? `<div style="margin-top:8px"><a class="btn btn-steel" href="${esc(url)}" target="_blank" rel="noopener">Open folder in SharePoint</a></div>` : ""}
      </div>`;
      env.onFiled?.(res, target);
    } catch (err) {
      step(current, "bad");
      const msg = err instanceof FriendlyError ? err.message : `Something went wrong: ${err.message}`;
      $("result").innerHTML = `<div class="banner bad">${esc(msg)}${err instanceof FriendlyError ? "" :
        "<br>Anything already saved is in the folder shown above. Try again, or send this message to the person looking after the add-in."}</div>`;
    } finally {
      S.busy = false; refresh();
    }
  }

  // ---------------------------------------------------------------- events
  $("find").onclick = () => find();
  jobIn.addEventListener("keydown", (e) => { if (e.key === "Enter") find(); });
  jobIn.addEventListener("change", () => { if (cleanJob(jobIn.value) !== S.job) find(); });
  subIn.addEventListener("input", () => { S.done = false; refresh(); });
  goBtn.onclick = go;
  env.host.onItemChanged?.(() => { S.done = false; loadEmail(); });

  loadEmail();
  return { find, go, state: S };
}
