// A pretend Microsoft Graph + SharePoint, in memory. Used by the demo page and the tests.
// It answers the same URLs the real add-in calls, so the real code runs unchanged against it.

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const err = (status, code, message) => json(status, { error: { code, message } });

export const DEMO_SITES = [
  { job: "000000", name: "000000Test", displayName: "000000 Test", folders: ["04 Document Control/02 Transmittals/In"] },
  { job: "183113", name: "183113KVLMSA", displayName: "183113 KVL MSA", folders: ["04 Document Control/02 Transmittals/In"] },
  { job: "185301", name: "185301KVLMillingMinovo", displayName: "185301 KVL Milling Minovo", folders: ["04 Document Control/02 Transmittals/In"] },
  { job: "185301", name: "185301KVL4MtpaMillingStudy", displayName: "185301 KVL 4Mtpa Milling Study", folders: ["04 Document Control/02 Transmittals/In"] },
  { job: "185501", name: "185501CopperOne", displayName: "185501 Copper One", folders: ["04 Document Control/02 Transmittals/In/20261023 Updated NWD"] },
  { job: "186201", name: "186201MontageNPIPiping", displayName: "186201 Montage NPI Piping", folders: ["04 Document Control/02 Transmittals"] },
  { job: "190100", name: "190100NoLibrary", displayName: "190100 Site Without Project Library", folders: null },
  { job: "146100", name: "146100-MtRawdon", displayName: "146100MtRawdon", folders: ["04 Document Control/02 Transmittals/In"] },
];

export function createFakeGraph({ sites = DEMO_SITES, convert = "ok", host = "https://designprocessvbd.sharepoint.com", messages = {}, searchable = true } = {}) {
  let seq = 1;
  const items = new Map();   // id -> item
  const drives = new Map();  // driveId -> { id, name, webUrl, rootId, siteId }
  const siteList = [];
  const sessions = new Map();
  const log = [];

  const newId = (p) => `${p}${(seq++).toString(36).toUpperCase().padStart(6, "0")}`;
  function mkItem(driveId, parentId, name, folder, bytes) {
    const parent = parentId ? items.get(parentId) : null;
    const webUrl = parent ? `${parent.webUrl}/${name}` : drives.get(driveId).webUrl;
    const it = { id: newId("I"), name, driveId, parentId, webUrl, folder: folder ? {} : undefined,
      file: folder ? undefined : { mimeType: "application/octet-stream" }, size: bytes ? bytes.length : 0, bytes,
      createdDateTime: new Date().toISOString() };
    items.set(it.id, it);
    return it;
  }
  const children = (id) => [...items.values()].filter((i) => i.parentId === id);
  const childNamed = (id, name) => children(id).find((c) => c.name.toLowerCase() === name.toLowerCase());
  const out = (it) => ({ id: it.id, name: it.name, webUrl: encodeURI(it.webUrl), size: it.size,
    ...(it.folder ? { folder: { childCount: children(it.id).length } } : { file: it.file }),
    parentReference: { driveId: it.driveId, id: it.parentId } });
  function ensurePath(driveId, path) {
    let cur = items.get(drives.get(driveId).rootId);
    for (const seg of path.split("/").filter(Boolean)) cur = childNamed(cur.id, seg) || mkItem(driveId, cur.id, seg, true);
    return cur;
  }
  function uniqueName(parentId, name) {
    if (!childNamed(parentId, name)) return name;
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let n = 1; ; n++) { const cand = `${stem} ${n}${ext}`; if (!childNamed(parentId, cand)) return cand; }
  }

  for (const s of sites) {
    const site = { id: `designprocessvbd.sharepoint.com,${newId("S")},${newId("W")}`, name: s.name, displayName: s.displayName,
      webUrl: `${host}/sites/${s.name}` };
    siteList.push(site);
    if (s.folders) {
      const d = { id: "b!" + newId("D"), name: "Project", webUrl: `${site.webUrl}/Project`, siteId: site.id };
      drives.set(d.id, d);
      const root = mkItem(d.id, null, "root", true); d.rootId = root.id;
      for (const f of s.folders) ensurePath(d.id, f);
    }
    const docs = { id: "b!" + newId("D"), name: "Documents", webUrl: `${site.webUrl}/Shared Documents`, siteId: site.id };
    drives.set(docs.id, docs);
    docs.rootId = mkItem(docs.id, null, "root", true).id;
  }

  function resolvePath(driveId, path) {
    let cur = items.get(drives.get(driveId)?.rootId);
    if (!cur) return null;
    for (const seg of path.split("/").filter(Boolean)) { cur = childNamed(cur.id, decodeURIComponent(seg)); if (!cur) return null; }
    return cur;
  }

  async function bodyBytes(body) {
    if (body == null) return new Uint8Array();
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    return new TextEncoder().encode(String(body));
  }

  async function fetchImpl(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url);
    log.push(`${method} ${u.pathname}${u.search}`);
    await new Promise((r) => setTimeout(r, 15));

    // Upload session chunks (no auth header expected)
    if (u.host === "upload.fake") {
      const s = sessions.get(u.pathname.slice(1));
      if (!s) return err(404, "itemNotFound", "session gone");
      const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(init.headers?.["Content-Range"] || "");
      const chunk = await bodyBytes(init.body);
      s.parts.push([Number(range[1]), chunk]);
      const got = s.parts.reduce((n, [, c]) => n + c.length, 0);
      if (got < Number(range[3])) return json(202, { nextExpectedRanges: [`${got}-`] });
      const all = new Uint8Array(got);
      for (const [off, c] of s.parts) all.set(c, off);
      const it = mkItem(s.driveId, s.parentId, uniqueName(s.parentId, s.name), false, all);
      sessions.delete(u.pathname.slice(1));
      return json(201, out(it));
    }

    if (!init.headers?.Authorization) return err(401, "InvalidAuthenticationToken", "no token");
    const p = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ""));
    let m;

    if (method === "GET" && p === "/sites") {
      const q = (u.searchParams.get("search") || "").toLowerCase();
      // Like the real search: whole words in the title only (so "185302KVLCrushing" style names need the fallbacks).
      const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/);
      return json(200, { value: siteList.filter((s) => q === "*" || (searchable && words(s.displayName).includes(q)))
        .map(({ id, name, displayName, webUrl }) => ({ id, name, displayName, webUrl })) });
    }
    if (method === "POST" && p === "/search/query") return json(200, { value: [{ hitsContainers: [{ hits: [] }] }] });
    if (method === "GET" && (m = /^\/sites\/([^/]+)\/drives$/.exec(p))) {
      return json(200, { value: [...drives.values()].filter((d) => d.siteId === m[1]).map(({ id, name, webUrl }) => ({ id, name, webUrl })) });
    }
    if (method === "GET" && (m = /^\/drives\/([^/]+)\/root:\/(.+)$/.exec(u.pathname.replace(/^\/v1\.0/, "")))) {
      const it = resolvePath(m[1], m[2]);
      return it ? json(200, out(it)) : err(404, "itemNotFound", "The resource could not be found.");
    }
    if (method === "POST" && (m = /^\/drives\/([^/]+)\/items\/([^/:]+)\/children$/.exec(p))) {
      const b = JSON.parse(init.body);
      if (childNamed(m[2], b.name)) return err(409, "nameAlreadyExists", "Name already exists");
      return json(201, out(mkItem(m[1], m[2], b.name, true)));
    }
    if (method === "PUT" && (m = /^\/drives\/([^/]+)\/items\/([^/:]+):\/(.+):\/content$/.exec(p))) {
      const bytes = await bodyBytes(init.body);
      const it = mkItem(m[1], m[2], uniqueName(m[2], m[3]), false, bytes);
      return json(201, out(it));
    }
    if (method === "POST" && (m = /^\/drives\/([^/]+)\/items\/([^/:]+):\/(.+):\/createUploadSession$/.exec(p))) {
      const key = newId("U");
      sessions.set(key, { driveId: m[1], parentId: m[2], name: m[3], parts: [] });
      return json(200, { uploadUrl: `https://upload.fake/${key}` });
    }
    if (method === "GET" && (m = /^\/drives\/([^/]+)\/items\/([^/]+)\/content$/.exec(p)) && u.searchParams.get("format") === "pdf") {
      const it = items.get(m[2]);
      if (!it) return err(404, "itemNotFound", "missing");
      if (it.size > 2 * 1024 * 1024) return err(406, "notSupported", "File too large to convert");
      if (convert !== "ok") return err(406, "notSupported", "Conversion not available (demo)");
      const pdf = new TextEncoder().encode(`%PDF-1.4\n% fake PDF of ${it.name}\n%%EOF\n`);
      return new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf" } });
    }
    if (method === "DELETE" && (m = /^\/drives\/([^/]+)\/items\/([^/]+)$/.exec(p))) {
      const it = items.get(m[2]);
      if (!it) return err(404, "itemNotFound", "missing");
      items.delete(m[2]);
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && (m = /^\/me\/messages\/([^/]+)\/\$value$/.exec(p))) {
      const b = messages[m[1]];
      return b ? new Response(b, { status: 200, headers: { "Content-Type": "text/plain" } }) : err(404, "ErrorItemNotFound", "not found");
    }
    return err(400, "BadRequest", `fake graph: unhandled ${method} ${p}`);
  }

  /** Folder tree under a site's In folder, for display. */
  function tree(siteDisplayName, path) {
    const site = siteList.find((s) => s.displayName === siteDisplayName);
    const d = [...drives.values()].find((x) => x.siteId === site?.id && x.name === "Project");
    if (!d) return null;
    const start = resolvePath(d.id, path);
    const walk = (it) => ({ name: it.name, folder: !!it.folder, size: it.size, bytes: it.bytes,
      children: it.folder ? children(it.id).sort((a, b) => a.name.localeCompare(b.name)).map(walk) : [] });
    return start ? walk(start) : null;
  }

  return { fetch: fetchImpl, items, log, tree, sites: siteList };
}
