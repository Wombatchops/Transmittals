// Files one email into  <job site> / Project / 04 Document Control / 02 Transmittals / In / <folder>
import { folderName, cleanName } from "./naming.js";
import { printEml, printHtml } from "./mime.js";

const CONVERT_MAX = 2 * 1024 * 1024; // Microsoft's limit for PDF conversion

export class FriendlyError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function accessMessage(job) {
  return `Job ${job} wasn't found in SharePoint, or you don't have access to its site. ` +
    `Ask the project manager to give you access to the job's SharePoint site, then try again.`;
}

/** Sites matching the job number, or a FriendlyError the user can act on. */
export async function findJob(graph, job) {
  const sites = await graph.findJobSites(job);
  if (!sites.length) throw new FriendlyError("NO_ACCESS", accessMessage(job));
  return sites;
}

/** The In folder on the job site (creates "In" if only it is missing). */
export async function findInFolder(graph, site, cfg) {
  const lib = await graph.findLibrary(site.id, cfg.library);
  if (!lib) throw new FriendlyError("NO_LIBRARY",
    `${site.displayName} has no "${cfg.library}" document library. Ask the project manager to check the site set-up.`);
  let folder = await graph.getByPath(lib.id, cfg.inPath);
  if (!folder) {
    const parts = cfg.inPath.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    const parent = await graph.getByPath(lib.id, parentPath);
    if (!parent) throw new FriendlyError("NO_FOLDER",
      `${site.displayName} has no "${parentPath}" folder. Ask the project manager to check the site set-up.`);
    folder = await graph.createFolder(lib.id, parent.id, parts[parts.length - 1]);
  }
  return { driveId: lib.id, folder, site };
}

/**
 * parsed:    output of parseEmail()
 * mime:      original email bytes (.eml)
 * renderPdf: async (html) => Uint8Array   - in-browser PDF, used if Microsoft's conversion fails
 * onStep:    (step, state, detail) => void   steps: folder | email | pdf | attachments
 */
export async function fileEmail({ graph, target, parsed, mime, subJob, cfg, renderPdf, onStep = () => {} }) {
  const { driveId } = target;
  const warnings = [];
  const files = [];

  onStep("folder", "run");
  const base = folderName(parsed.date, parsed.subject, subJob);
  const folder = await graph.createUniqueFolder(driveId, target.folder.id, base);
  const stem = folder.name; // includes " (2)" if this was a repeat
  onStep("folder", "ok", folder.name);

  // The email itself, renamed to match the folder.
  onStep("email", "run");
  const emlItem = await graph.upload(driveId, folder.id, `${stem}.eml`, mime);
  files.push(emlItem.name);
  onStep("email", "ok", emlItem.name);

  // Attachments first (so the PDF header can list them).
  onStep("attachments", "run");
  const saved = [];
  for (const a of parsed.attachments) {
    try {
      const it = await graph.upload(driveId, folder.id, cleanName(a.name, 120, "attachment"), a.bytes);
      saved.push(it.name); files.push(it.name);
    } catch (e) {
      warnings.push(`Attachment "${a.name}" not saved: ${e.message}`);
    }
  }
  onStep("attachments", warnings.length ? "warn" : "ok",
    `${saved.length} saved${parsed.inline.size ? `, ${parsed.inline.size} embedded image(s) printed in PDF` : ""}`);

  // PDF
  onStep("pdf", "run");
  const pdfName = `${stem}.pdf`;
  let pdf = null, how = "";
  if (cfg.pdfEngine !== "client") {
    let temp = null;
    try {
      let src = emlItem;
      if (mime.length > CONVERT_MAX) {
        const small = printEml(parsed);
        if (small.length > CONVERT_MAX) throw new Error("email body and images are over 2 MB");
        temp = await graph.upload(driveId, folder.id, `~DocControl print ${Date.now()}.eml`, small);
        src = temp;
      }
      pdf = await graph.convertToPdf(driveId, src.id);
      how = "Microsoft 365";
    } catch (e) {
      warnings.push(`Microsoft PDF conversion failed (${e.message}); used in-browser PDF instead.`);
    } finally {
      if (temp) await graph.remove(driveId, temp.id);
    }
  }
  if (!pdf) {
    try {
      pdf = await renderPdf(printHtml(parsed, saved));
      how = "in-browser";
    } catch (e) {
      warnings.push(`PDF not created: ${e.message}`);
    }
  }
  if (pdf) {
    const it = await graph.upload(driveId, folder.id, pdfName, pdf);
    files.push(it.name);
    const expected = cfg.pdfEngine === "client" ? "in-browser" : "Microsoft 365";
    onStep("pdf", how === expected ? "ok" : "warn", `${it.name} (${how})`);
  } else {
    onStep("pdf", "bad", "not created");
  }

  return { folder, files, warnings, pdfEngine: how };
}

