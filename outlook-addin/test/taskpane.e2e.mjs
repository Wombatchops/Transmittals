// Loads the real taskpane.html with a stand-in Office.js to check the Outlook entry point starts.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { SAMPLES } from "../src/samples.js";
const out = process.argv[2] || ".";
const b64 = Buffer.from(SAMPLES[0].eml).toString("base64");
const officeStub = `window.Office = {
  AsyncResultStatus:{Succeeded:"succeeded",Failed:"failed"}, EventType:{ItemChanged:"olkItemSelectedChanged"},
  MailboxEnums:{RestVersion:{v2_0:"v2.0"}},
  context:{ requirements:{ isSetSupported:(n)=>n!=="NestedAppAuth" || window.__naa },
    mailbox:{ convertToRestId:(id)=>id, addHandlerAsync:()=>{},
      item:{ subject:"x", itemId:"AAA", dateTimeCreated:new Date().toISOString(), attachments:[],
        getAsFileAsync:(cb)=>cb({status:"succeeded", value:${JSON.stringify(b64)}}) } } },
  onReady:(cb)=>{ setTimeout(()=>cb({host:"Outlook"}),10); return Promise.resolve({host:"Outlook"}); } };`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 350, height: 900 } });
const errors = [];
pg.on("pageerror", (e) => errors.push(e.message));
await pg.route(/appsforoffice\.microsoft\.com/, (r) => r.fulfill({ body: officeStub, contentType: "application/javascript" }));
await pg.route(/fonts\./, (r) => r.abort());
await pg.goto("file://" + path.resolve("dist/taskpane.html"));
await pg.locator(".mail-subj").waitFor({ timeout: 15000 });
const setup = await pg.locator("#setup").innerText();
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
ok((await pg.locator(".mail-subj").innerText()).includes("Screen Underflow Tank"), "email read via Outlook getAsFileAsync");
ok(setup.includes("Not set up yet"), "shows not-configured banner while client ID is empty");
ok(await pg.locator("#go").isDisabled(), "send disabled until configured");
await pg.screenshot({ path: `${out}/07_taskpane_350.png`, fullPage: true });
ok(!errors.length, "no page errors " + errors.join("; "));
await b.close();
