// Folder / file naming rules - shared by the add-in and the tests.

export const MAX_SUBJECT = 80;

// Characters SharePoint / OneDrive won't accept in a name.
const ILLEGAL = /["*:<>?/\\|\x00-\x1f\x7f]/g;
const RESERVED = new Set(["CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]);

/** Make text safe as a SharePoint file/folder name. */
export function cleanName(text, maxLen, fallback) {
  let t = String(text ?? "").replace(/[\r\n\t]+/g, " ").replace(ILLEGAL, "");
  t = t.replace(/\s+/g, " ").trim();
  t = t.slice(0, maxLen).replace(/[ .]+$/, "").replace(/^~\$/, "").replace(/^[ .]+/, "");
  if (!t) t = fallback;
  if (RESERVED.has(t.toUpperCase().split(".")[0])) t = "_" + t;
  if (/^(_vti_|forms$)/i.test(t)) t = "_" + t;
  return t;
}

/** YYYYMMDD in the PC's local time zone. */
export function yyyymmdd(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Job numbers: letters, digits, hyphen. */
export function cleanJob(text) {
  return String(text ?? "").trim().replace(/\s+/g, "").replace(/[^A-Za-z0-9-]/g, "");
}

/** "YYYYMMDD Subject"  or  "YYYYMMDD SUB Subject" (space separated, as in 02 Transmittals/In). */
export function folderName(date, subject, subJob) {
  const parts = [yyyymmdd(date)];
  const sub = cleanJob(subJob);
  if (sub) parts.push(sub);
  parts.push(cleanName(subject, MAX_SUBJECT, "NO SUBJECT"));
  return parts.join(" ");
}

/** "Name (2)", "Name (3)" ... for repeats - same style already used in the In folders. */
export function numbered(name, n) {
  return n <= 1 ? name : `${name} (${n})`;   // folders only - no extension handling
}

export const JOB_DIGITS = 6;

/** Head job numbers are exactly 6 digits. */
export function isJobNumber(job) {
  return new RegExp(`^\\d{${JOB_DIGITS}}$`).test(String(job ?? ""));
}

/** Match rule: the first 6 characters of the site name (or its title) equal the job number. */
export function siteMatchesJob(site, job) {
  const j = cleanJob(job);
  if (!isJobNumber(j)) return false;
  return [site.name, site.displayName].some((s) => String(s ?? "").trim().slice(0, JOB_DIGITS) === j);
}

/** Pull a likely job number (6 digits) from a subject line, for a suggestion only. */
export function suggestJob(subject) {
  const m = String(subject ?? "").match(/(?:^|[^0-9])(\d{6})(?![0-9])/);
  return m ? m[1] : "";
}
