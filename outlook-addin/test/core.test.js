import { test } from "node:test";
import assert from "node:assert/strict";
import { folderName, cleanName, siteMatchesJob, suggestJob, numbered } from "../src/naming.js";
import { parseEmail, printEml, printHtml } from "../src/mime.js";
import { Graph } from "../src/graph.js";
import { createFakeGraph } from "../src/fakegraph.js";
import { findJob, findInFolder, fileEmail, FriendlyError } from "../src/filer.js";
import { SAMPLES } from "../src/samples.js";

process.env.TZ = "Australia/Brisbane";
const CFG = { library: "Project", inPath: "04 Document Control/02 Transmittals/In", pdfEngine: "graph" };
const enc = (s) => new TextEncoder().encode(s);
const fakePdf = async () => enc("%PDF-1.4 client");

test("folder names", () => {
  const d = new Date("2026-10-28T14:32:00+10:00");
  assert.equal(folderName(d, "RE: Lot 12 / approval?", ""), "20261028 RE Lot 12 approval");
  assert.equal(folderName(d, "Updated NWD", " 02 "), "20261028 02 Updated NWD");
  assert.equal(folderName(d, "   ", ""), "20261028 NO SUBJECT");
  assert.equal(cleanName("a".repeat(200), 80, "x").length, 80);
  assert.equal(cleanName("CON", 80, "x"), "_CON");
  assert.equal(numbered("20261023 Updated NWD", 2), "20261023 Updated NWD (2)");
});

test("job matching", () => {
  assert.ok(siteMatchesJob({ displayName: "185301 KVL Milling", name: "185301KVLMilling" }, "185301"));
  assert.ok(siteMatchesJob({ displayName: "x", name: "146100-MtRawdon" }, "146100"));
  assert.ok(!siteMatchesJob({ displayName: "1853011 Other", name: "1853011Other" }, "185301"));
  assert.ok(!siteMatchesJob({ displayName: "Project 185301", name: "P185301" }, "185301"));
  assert.equal(suggestJob("RE: 185501 Screen tank"), "185501");
  assert.equal(suggestJob("Tel 0412345678"), "");
});

test("parse vendor email: embedded images skipped, attachments kept", async () => {
  const p = await parseEmail(enc(SAMPLES[0].eml));
  assert.equal(p.subject, "RE: 185501 Screen Underflow Tank - Vendor model rev B");
  assert.equal(p.inline.size, 2);
  assert.deepEqual(p.attachments.map((a) => a.name).sort(),
    ["Equipment list rev B.csv", "RFI 014 - Underflow tank nozzle N3.eml", "Tank pad photo.jpg", "UFT-001 GA rev B.pdf"]);
  const html = printHtml(p, ["a.pdf"]);
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(!html.includes("cid:"));
  const small = new TextDecoder().decode(printEml(p));
  assert.ok(small.includes("Content-ID: <logo01@acme>") && !small.includes("UFT-001 GA"));
});

test("no date -> fallback date", async () => {
  const p = await parseEmail(enc("Subject: x\r\n\r\nbody"), "2026-01-02T03:00:00Z");
  assert.equal(p.dateFromEmail, false);
  assert.equal(folderName(p.date, p.subject, ""), "20260102 x");
});

function setup(opts) {
  const fake = createFakeGraph(opts);
  return { fake, graph: new Graph(async () => "tok", fake.fetch) };
}

test("job not found -> access message", async () => {
  const { graph } = setup();
  await assert.rejects(findJob(graph, "999999"), (e) => e instanceof FriendlyError && /project manager/.test(e.message));
});

test("duplicate job numbers return both sites", async () => {
  const { graph } = setup();
  const sites = await findJob(graph, "185301");
  assert.equal(sites.length, 2);
});

test("site without Project library -> friendly error", async () => {
  const { graph } = setup();
  const [site] = await findJob(graph, "190100");
  await assert.rejects(findInFolder(graph, site, CFG), (e) => e.code === "NO_LIBRARY");
});

test("missing In folder is created", async () => {
  const { graph, fake } = setup();
  const [site] = await findJob(graph, "186201");
  const t = await findInFolder(graph, site, CFG);
  assert.equal(t.folder.name, "In");
  assert.ok(fake.tree("186201 Montage NPI Piping", CFG.inPath));
});

test("file vendor email end to end (Microsoft conversion)", async () => {
  const { graph, fake } = setup();
  const [site] = await findJob(graph, "185501");
  const target = await findInFolder(graph, site, CFG);
  const mime = enc(SAMPLES[0].eml);
  const parsed = await parseEmail(mime);
  const steps = [];
  const r = await fileEmail({ graph, target, parsed, mime, subJob: "02", cfg: CFG, renderPdf: fakePdf, onStep: (k, s) => steps.push(`${k}:${s}`) });
  assert.equal(r.folder.name, "20261028 02 RE 185501 Screen Underflow Tank - Vendor model rev B");
  assert.equal(r.warnings.length, 0);
  assert.equal(r.pdfEngine, "Microsoft 365");
  const tree = fake.tree("185501 Copper One", CFG.inPath);
  const f = tree.children.find((c) => c.name === r.folder.name);
  assert.deepEqual(f.children.map((c) => c.name).sort(), [
    "20261028 02 RE 185501 Screen Underflow Tank - Vendor model rev B.eml",
    "20261028 02 RE 185501 Screen Underflow Tank - Vendor model rev B.pdf",
    "Equipment list rev B.csv", "RFI 014 - Underflow tank nozzle N3.eml", "Tank pad photo.jpg", "UFT-001 GA rev B.pdf"]);
  assert.ok(!f.children.some((c) => /image00/.test(c.name)), "embedded images must not be saved");
  assert.ok(tree.children.some((c) => c.name === "20261023 Updated NWD"), "existing folders untouched");
  assert.ok(steps.includes("pdf:ok"));

  // second time -> "(2)" folder and matching file names
  const r2 = await fileEmail({ graph, target, parsed, mime, subJob: "02", cfg: CFG, renderPdf: fakePdf });
  assert.equal(r2.folder.name, "20261028 02 RE 185501 Screen Underflow Tank - Vendor model rev B (2)");
  assert.ok(r2.files.includes("20261028 02 RE 185501 Screen Underflow Tank - Vendor model rev B (2).eml"));
});

test("conversion unavailable -> in-browser PDF with warning", async () => {
  const { graph } = setup({ convert: "fail" });
  const [site] = await findJob(graph, "000000");
  const target = await findInFolder(graph, site, CFG);
  const mime = enc(SAMPLES[1].eml);
  const parsed = await parseEmail(mime);
  const r = await fileEmail({ graph, target, parsed, mime, subJob: "", cfg: CFG, renderPdf: fakePdf });
  assert.equal(r.folder.name, "20261029 Site meeting minutes 2910 DRAFT");
  assert.equal(r.pdfEngine, "in-browser");
  assert.equal(r.warnings.length, 1);
});

test("big email (>2 MB) converts a body-only copy, temp file removed, chunked upload", async () => {
  const { graph, fake } = setup();
  const [site] = await findJob(graph, "183113");
  const target = await findInFolder(graph, site, CFG);
  const big = "A".repeat(6 * 1024 * 1024);
  const eml = SAMPLES[0].eml.replace("--MIX--", `--MIX\r\nContent-Type: application/octet-stream; name="big.bin"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="big.bin"\r\n\r\n${btoa(big).replace(/.{1,76}/g, "$&\r\n")}\r\n--MIX--`);
  const mime = enc(eml);
  const parsed = await parseEmail(mime);
  const r = await fileEmail({ graph, target, parsed, mime, subJob: "", cfg: CFG, renderPdf: fakePdf });
  assert.equal(r.pdfEngine, "Microsoft 365");
  const f = fake.tree("183113 KVL MSA", CFG.inPath).children[0];
  assert.ok(!f.children.some((c) => c.name.startsWith("~DocControl")), "temp file deleted");
  assert.equal(f.children.find((c) => c.name === "big.bin").size, big.length);
  assert.ok(fake.log.some((l) => l.includes("createUploadSession")));
});
