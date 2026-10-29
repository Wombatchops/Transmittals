/* global __DC_CONFIG__ */
// Filled in at build time from addin.config.json.
export const CONFIG = typeof __DC_CONFIG__ !== "undefined" ? __DC_CONFIG__ : {
  version: "dev", clientId: "", tenant: "designprocess.net.au", baseUrl: "",
  library: "Project", inPath: "04 Document Control/02 Transmittals/In", pdfEngine: "graph",
};

export const VERSION_HISTORY = [
  { v: "1.1", date: "2026-10-30", notes: [
    "Job match rule: the head job number must be 6 digits and equal the first 6 characters of the SharePoint site name.",
    "If Microsoft's site search misses a site, the add-in checks every site you can open using the same rule.",
  ] },
  { v: "1.0", date: "2026-10-30", notes: [
    "Pilot release: Send to Doc Control button in Outlook.",
    "Finds the job's SharePoint site from the head job number; optional sub job number added after the date.",
    "Creates 'YYYYMMDD [sub] Subject' in Project › 04 Document Control › 02 Transmittals › In with the email (.eml), a PDF and the attachments.",
    "Embedded images printed in the PDF, not saved separately.",
  ] },
];
