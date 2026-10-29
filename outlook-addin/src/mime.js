// Read an email (.eml / MIME bytes) into the pieces Doc Control needs.
import PostalMime, { decodeWords } from "postal-mime";

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|tiff?|webp|emz|wmz)$/i;

function addr(a) {
  if (!a) return "";
  const list = Array.isArray(a) ? a : [a];
  return list.map((x) => {
    if (x.group) return `${x.name}: ${x.group.map((g) => addr(g)).join(", ")}`;
    return x.name && x.address ? `${x.name} <${x.address}>` : (x.address || x.name || "");
  }).filter(Boolean).join("; ");
}

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new TextEncoder().encode(String(content ?? ""));
}

function cidUsed(cid, html) {
  return !!cid && !!html && html.toLowerCase().includes(("cid:" + cid).toLowerCase());
}

function rfc822Subject(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 64 * 1024)).split(/\r?\n\r?\n/)[0];
  const m = head.replace(/\r?\n[ \t]+/g, " ").match(/^subject:\s*(.*)$/im);
  return m ? decodeWords(m[1]).trim() : "";
}

/**
 * Returns { date, subject, from, to, cc, html, text, inline, attachments }
 *  inline:      Map cid -> { mimeType, bytes }   (embedded images: printed in PDF, not saved)
 *  attachments: [{ name, mimeType, bytes }]      (saved as files)
 */
export async function parseEmail(raw, fallbackDate) {
  const email = await PostalMime.parse(raw, { forceRfc822Attachments: true, attachmentEncoding: "arraybuffer" });
  const html = email.html || "";
  const inline = new Map();
  const attachments = [];
  let n = 0;

  for (const a of email.attachments || []) {
    n++;
    const bytes = toBytes(a.content);
    const cid = (a.contentId || "").replace(/^<|>$/g, "").trim();
    const mime = (a.mimeType || "application/octet-stream").toLowerCase();
    const isImage = mime.startsWith("image/") || IMAGE_EXT.test(a.filename || "");

    if (isImage && cid) {
      inline.set(cid, { mimeType: mime.startsWith("image/") ? mime : "image/png", bytes });
      // Embedded in the body (logo, signature, pasted screenshot): print only, don't save.
      if (a.disposition !== "attachment" || cidUsed(cid, html) || a.related) continue;
    }

    let name = a.filename;
    if (!name && mime === "message/rfc822") name = (rfc822Subject(bytes) || "Attached email") + ".eml";
    if (!name) {
      const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "application/pdf": ".pdf",
        "text/calendar": ".ics", "text/plain": ".txt" }[mime] || ".bin";
      name = `attachment ${n}${ext}`;
    }
    attachments.push({ name, mimeType: mime, bytes });
  }

  let date = email.date ? new Date(email.date) : null;
  let dateFromEmail = true;
  if (!date || isNaN(date)) { date = fallbackDate ? new Date(fallbackDate) : new Date(); dateFromEmail = false; }

  return {
    date, dateFromEmail,
    subject: (email.subject || "").trim(),
    from: addr(email.from), to: addr(email.to), cc: addr(email.cc),
    html, text: email.text || "",
    inline, attachments,
  };
}

// ---------------------------------------------------------------- printing --
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Strip anything active from email HTML before rendering it. */
export function sanitizeHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(iframe|object|embed|base|link|meta)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function sentText(date) {
  return date.toLocaleString("en-AU", { weekday: "long", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit" });
}

/** Header block + body as one HTML document, embedded images inlined. Used for the in-browser PDF. */
export function printHtml(p, attachmentNames = []) {
  const row = (k, v) => (v ? `<tr><td class="k">${k}</td><td>${escapeHtml(v)}</td></tr>` : "");
  let body;
  if (p.html) {
    body = p.html;
    for (const [cid, img] of p.inline) {
      const uri = `data:${img.mimeType};base64,${b64(img.bytes)}`;
      body = body.split(new RegExp("cid:" + cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(uri);
    }
    const m = body.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    body = sanitizeHtml(m ? m[1] : body);
  } else {
    body = `<pre class="plain">${escapeHtml(p.text || "(no body)")}</pre>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
 body{font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0;padding:28px 34px;color:#000;background:#fff;width:794px;box-sizing:border-box}
 table.hdr td{vertical-align:top;padding:1px 8px 1px 0;font-size:10.5pt}
 table.hdr td.k{font-weight:bold;white-space:nowrap}
 hr.sep{border:0;border-top:1.5px solid #000;margin:8px 0 14px}
 pre.plain{white-space:pre-wrap;font-family:Calibri,Arial,sans-serif;margin:0}
 img{max-width:100%;height:auto}
</style></head><body><table class="hdr">${row("From:", p.from)}${row("Sent:", sentText(p.date))}${row("To:", p.to)}${row("Cc:", p.cc)}${row("Subject:", p.subject || "(no subject)")}${row("Attachments:", attachmentNames.join("; "))}</table><hr class="sep">${body}</body></html>`;
}

function encodeHeader(v) {
  const s = String(v ?? "");
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(new TextEncoder().encode(s))}?=`;
}

function wrap76(s) { return s.replace(/.{1,76}/g, "$&\r\n"); }

/** A smaller copy of the email (body + embedded images, no attachments) for PDF conversion. */
export function printEml(p) {
  const bnd = "----=_DocControl_" + Math.random().toString(36).slice(2);
  const L = [];
  L.push(`From: ${encodeHeader(p.from)}`);
  if (p.to) L.push(`To: ${encodeHeader(p.to)}`);
  if (p.cc) L.push(`Cc: ${encodeHeader(p.cc)}`);
  L.push(`Subject: ${encodeHeader(p.subject)}`);
  L.push(`Date: ${p.date.toUTCString().replace("GMT", "+0000")}`);
  L.push("MIME-Version: 1.0");
  const bodyHtml = p.html || `<pre style="white-space:pre-wrap;font-family:Calibri,Arial,sans-serif">${escapeHtml(p.text)}</pre>`;
  L.push(`Content-Type: multipart/related; boundary="${bnd}"`, "", `--${bnd}`,
    "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "",
    wrap76(b64(new TextEncoder().encode(bodyHtml))));
  for (const [cid, img] of p.inline) {
    L.push(`--${bnd}`, `Content-Type: ${img.mimeType}`, "Content-Transfer-Encoding: base64",
      `Content-ID: <${cid}>`, "Content-Disposition: inline", "", wrap76(b64(img.bytes)));
  }
  L.push(`--${bnd}--`, "");
  return new TextEncoder().encode(L.join("\r\n"));
}
