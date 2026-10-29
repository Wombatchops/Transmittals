// Minimal Microsoft Graph client for the SharePoint calls Doc Control makes.
import { siteMatchesJob, numbered } from "./naming.js";

const BASE = "https://graph.microsoft.com/v1.0";
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const CHUNK = 327680 * 10; // 3.2 MB, must be a multiple of 320 KiB

export class GraphError extends Error {
  constructor(status, code, message) { super(message || code || `HTTP ${status}`); this.status = status; this.code = code; }
}

const enc = (path) => path.split("/").map(encodeURIComponent).join("/");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Graph {
  constructor(getToken, fetchImpl) {
    this.getToken = getToken;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  }

  async req(method, path, { body, headers = {}, raw = false, absolute = false, auth = true, okStatus } = {}) {
    const url = absolute ? path : BASE + path;
    for (let attempt = 0; ; attempt++) {
      const h = { ...headers };
      if (auth) h.Authorization = "Bearer " + (await this.getToken());
      let payload = body;
      if (body && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer) && !(body instanceof Blob) && typeof body !== "string") {
        payload = JSON.stringify(body); h["Content-Type"] = "application/json";
      }
      const res = await this.fetch(url, { method, headers: h, body: payload });
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
        const wait = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await sleep(Math.min(wait, 20) * 1000);
        continue;
      }
      if (!res.ok && !(okStatus && okStatus.includes(res.status))) {
        let code = "", msg = "";
        try { const j = await res.json(); code = j.error?.code; msg = j.error?.message; } catch { /* not json */ }
        throw new GraphError(res.status, code, msg || `${method} failed (${res.status})`);
      }
      if (raw) return res;
      if (res.status === 204) return null;
      const ct = res.headers.get("Content-Type") || "";
      return ct.includes("json") ? res.json() : res.arrayBuffer();
    }
  }

  // ------------------------------------------------------------ sites --
  /** Job sites the signed-in user can see whose name starts with the job number. */
  async findJobSites(job) {
    const found = new Map();
    const add = (s) => { if (s && siteMatchesJob(s, job) && !found.has(s.id)) found.set(s.id, s); };
    try {
      const r = await this.req("GET", `/sites?search=${encodeURIComponent(job)}&$select=id,name,displayName,webUrl&$top=100`);
      (r.value || []).forEach(add);
    } catch (e) { if (e.status !== 400 && e.status !== 404) throw e; }
    if (!found.size) {
      // Fallback 1: Microsoft Search with a prefix wildcard (catches names like "185302KVLCrushing").
      try {
        const r = await this.req("POST", "/search/query", { body: { requests: [{ entityTypes: ["site"], query: { queryString: `${job}*` }, size: 100 }] } });
        for (const c of r.value?.[0]?.hitsContainers || []) for (const h of c.hits || []) {
          const s = h.resource; if (s) add({ id: s.id, name: s.name, displayName: s.displayName, webUrl: s.webUrl });
        }
      } catch (e) { if (e.status >= 500) throw e; }
    }
    if (!found.size) {
      // Fallback 2: list every site this person can open and apply the same first-6-characters rule.
      try {
        let url = `/sites?search=*&$select=id,name,displayName,webUrl&$top=200`;
        for (let page = 0; url && page < 25; page++) {
          const r = await this.req("GET", url.replace("https://graph.microsoft.com/v1.0", ""));
          (r.value || []).forEach(add);
          url = r["@odata.nextLink"] || null;
        }
      } catch (e) { if (e.status >= 500) throw e; }
    }
    return [...found.values()].sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  }

  async findLibrary(siteId, libraryName) {
    const r = await this.req("GET", `/sites/${siteId}/drives?$select=id,name,webUrl`);
    const want = libraryName.toLowerCase();
    return (r.value || []).find((d) => d.name?.toLowerCase() === want ||
      decodeURIComponent(d.webUrl || "").toLowerCase().endsWith("/" + want)) || null;
  }

  async getByPath(driveId, path) {
    try { return await this.req("GET", `/drives/${driveId}/root:/${enc(path)}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }

  // ---------------------------------------------------------- folders --
  async createFolder(driveId, parentId, name) {
    return this.req("POST", `/drives/${driveId}/items/${parentId}/children`,
      { body: { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" } });
  }

  /** Creates name, or "name (2)", "name (3)"... if it already exists. */
  async createUniqueFolder(driveId, parentId, name) {
    for (let n = 1; n < 100; n++) {
      try { return await this.createFolder(driveId, parentId, numbered(name, n)); }
      catch (e) { if (e.status !== 409) throw e; }
    }
    throw new Error(`Too many folders named "${name}"`);
  }

  // ------------------------------------------------------------ files --
  async upload(driveId, parentId, name, bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const target = `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}:`;
    if (data.length <= SIMPLE_UPLOAD_MAX) {
      return this.req("PUT", `${target}/content?@microsoft.graph.conflictBehavior=rename`,
        { body: data, headers: { "Content-Type": "application/octet-stream" } });
    }
    const s = await this.req("POST", `${target}/createUploadSession`,
      { body: { item: { "@microsoft.graph.conflictBehavior": "rename" } } });
    let item = null;
    for (let start = 0; start < data.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, data.length);
      const res = await this.req("PUT", s.uploadUrl, {
        absolute: true, auth: false, raw: true, body: data.subarray(start, end),
        headers: { "Content-Range": `bytes ${start}-${end - 1}/${data.length}` },
      });
      if (res.status === 200 || res.status === 201) item = await res.json();
    }
    return item;
  }

  /** PDF of a file already in SharePoint (Microsoft converts it; source must be 2 MB or less). */
  async convertToPdf(driveId, itemId) {
    const buf = await this.req("GET", `/drives/${driveId}/items/${itemId}/content?format=pdf`);
    const bytes = new Uint8Array(buf);
    if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("conversion did not return a PDF");
    return bytes;
  }

  async remove(driveId, itemId) {
    try { await this.req("DELETE", `/drives/${driveId}/items/${itemId}`); } catch { /* temp file - ignore */ }
  }

  async messageMime(restId) {
    return new Uint8Array(await this.req("GET", `/me/messages/${encodeURIComponent(restId)}/$value`));
  }
}
