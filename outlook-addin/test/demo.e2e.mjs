// Browser test of the real task pane UI on the demo page (pretend SharePoint).
import { chromium } from "playwright";
import path from "node:path";
const out = process.argv[2] || ".";
const file = "file://" + path.resolve("dist/DocControl_Demo_v1.1.html");
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1360, height: 1000 } });
const errors = [];
pg.on("pageerror", (e) => errors.push("pageerror: " + e.message));
pg.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|cdnjs|ERR_|net::/.test(m.text())) errors.push("console: " + m.text()); });
await pg.route(/fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
// cdnjs isn't reachable from the build sandbox: serve the same pinned pdf.js files from node_modules.
await pg.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\/(.+)$/, (r) => {
  const f = r.request().url().split("/").pop();
  return r.fulfill({ path: path.resolve("node_modules/pdfjs-dist/build/" + f), contentType: "application/javascript" });
});
await pg.goto(file);
const pane = pg.locator("#pane");
await pane.locator(".mail-subj").waitFor();
const t = async (sel) => (await pane.locator(sel).first().innerText()).trim();
const check = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) process.exitCode = 1; };

check((await t("#preview")) === "20261028 RE 185501 Screen Underflow Tank - Vendor model rev B", "preview " + await t("#preview"));
check((await t("#mail")).includes("4 attachments to save · 2 embedded images"), "attachment counts");
await pg.screenshot({ path: `${out}/01_start.png`, fullPage: true });

// not found
await pane.locator("#job").fill("999999"); await pane.locator("#find").click();
await pane.locator("#siteArea .banner.bad").waitFor();
check((await t("#siteArea")).includes("Ask the project manager"), "no-access message");
check(await pane.locator("#go").isDisabled(), "button disabled without site");
await pg.screenshot({ path: `${out}/02_noaccess.png` });

// not 6 digits
await pane.locator("#job").fill("18550"); await pane.locator("#find").click();
check((await t("#siteArea")).includes("6 digits"), "5-digit job rejected with hint");
// site title with no space after the number -> found by the full-list fallback
await pane.locator("#job").fill("146100"); await pane.locator("#find").click();
await pg.waitForFunction(() => document.querySelector("#siteArea .nm")?.textContent === "146100MtRawdon", null, { timeout: 15000 });
check(true, "146100MtRawdon found via first-6-characters rule");

// duplicates
await pane.locator("#job").fill("185301"); await pane.locator("#find").click();
await pane.locator("input[name=site]").first().waitFor();
check((await pane.locator("input[name=site]").count()) === 2, "two 185301 sites to choose from");
check(await pane.locator("#go").isDisabled(), "must pick one first");
await pane.locator("input[name=site]").nth(1).check();
check(!(await pane.locator("#go").isDisabled()), "enabled after picking");
await pg.screenshot({ path: `${out}/03_duplicates.png` });

// suggestion chip from subject + sub job + file
await pane.locator(".chip.suggest").click();
await pane.locator(".site.sel, .site").first().waitFor();
await pg.waitForFunction(() => document.querySelector("#siteArea .nm")?.textContent === "185501 Copper One");
await pane.locator("#sub").fill("02");
check((await t("#preview")) === "20261028 02 RE 185501 Screen Underflow Tank - Vendor model rev B", "preview with sub job");
await pane.locator("#go").click();
await pane.locator("#result .banner").waitFor({ timeout: 60000 });
const res = await t("#result");
check(res.includes("Filed to 185501 Copper One") && res.includes("6 files saved"), "filed: " + res.replace(/\s+/g, " ").slice(0, 160));
check(!(await pane.locator("#result .banner").getAttribute("class")).includes("bad"), "no error banner");
const tree = await pg.locator("#spTree").innerText();
for (const n of ["20261023 Updated NWD", "20261028 02 RE 185501 Screen Underflow Tank - Vendor model rev B.pdf", ".eml", "UFT-001 GA rev B.pdf", "Tank pad photo.jpg", "Equipment list rev B.csv", "RFI 014 - Underflow tank nozzle N3.eml"])
  check(tree.includes(n), "tree has " + n);
check(!tree.includes("image001"), "embedded images not saved");
check((await pane.locator("#go").innerText()).includes("Sent"), "button shows Sent");
await pg.screenshot({ path: `${out}/04_filed.png`, fullPage: true });

// open the PDF preview
await pg.locator(".tn.fl", { hasText: "Vendor model rev B.pdf" }).click();
await pg.waitForTimeout(2500);
const pvText = await pg.locator("#pvBody").innerText();
check((await pg.locator("#pvBody canvas").count()) >= 1, "PDF preview renders pages " + pvText.slice(0, 60));
await pg.screenshot({ path: `${out}/05_pdf.png`, fullPage: true });

// switch email -> pane reloads; missing In folder created
await pg.locator(".mrow", { hasText: "Sam Lee" }).click();
await pg.waitForFunction(() => document.querySelector("#pane #preview")?.textContent.startsWith("20261029"));
check((await t("#preview")) === "20261029 02 Site meeting minutes 2910 DRAFT", "preview after switching email (sub job kept)");
check(!(await pane.locator("#go").isDisabled()), "still ready to send (same job kept)");
await pane.locator("#job").fill("186201"); await pane.locator("#find").click();
await pg.waitForFunction(() => document.querySelector("#siteArea .nm")?.textContent?.startsWith("186201"));
await pane.locator("#sub").fill("");
await pane.locator("#go").click();
await pane.locator("#result .banner").waitFor({ timeout: 60000 });
check((await t("#result")).includes("Filed to 186201"), "filed into site whose In folder was missing");
check((await pg.locator("#spTree").innerText()).includes("20261029 Site meeting minutes 2910 DRAFT.pdf"), "pdf for plain email");

// phone width
await pg.setViewportSize({ width: 400, height: 900 });
const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
check(sw <= 400, "no sideways scroll at 400px (" + sw + ")");
await pg.screenshot({ path: `${out}/06_phone.png`, fullPage: false });

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
if (errors.length) process.exitCode = 1;
await b.close();
