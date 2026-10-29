// Sample emails (as raw .eml text) for the demo page and tests. Fictional people and companies.
import { ASSETS } from "./sample-assets.js";

const wrap = (b64) => b64.replace(/.{1,76}/g, "$&\r\n");
const b64utf8 = (s) => btoa(unescape(encodeURIComponent(s)));

function vendorEmail() {
  const html = `<html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt">
<p>Hi Mark,</p>
<p>Please find attached <b>Rev B</b> of the screen underflow tank GA and the updated equipment list.
The N3 nozzle has moved 150&nbsp;mm east to clear the launder - see screenshot below.</p>
<p><img src="cid:shot01@acme" alt="screenshot" width="420"></p>
<p>Also attached a site photo of the existing tank pad.</p>
<p>Regards,<br>Jo Citizen<br>Project Engineer &ndash; Acme Vendor Pty Ltd</p>
<p><img src="cid:logo01@acme" alt="Acme logo" width="180"></p>
</body></html>`;
  const inner = [
    "From: Mark Rankin <mark@example.com>", "To: Jo Citizen <jo@acme.example>",
    "Subject: RFI 014 - Underflow tank nozzle N3", "Date: Mon, 26 Oct 2026 08:10:00 +1000",
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", "Jo, can you confirm the N3 nozzle location? Thanks, Mark",
  ].join("\r\n");
  return [
    "From: Jo Citizen <jo@acme.example>",
    "To: Mark Rankin <mark@example.com>",
    "Cc: Project Admin <admin@example.com>",
    "Subject: RE: 185501 Screen Underflow Tank - Vendor model rev B",
    "Date: Wed, 28 Oct 2026 14:32:00 +1000",
    "Message-ID: <demo-1@acme.example>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="MIX"',
    "",
    "--MIX",
    'Content-Type: multipart/related; boundary="REL"',
    "",
    "--REL",
    'Content-Type: multipart/alternative; boundary="ALT"',
    "",
    "--ALT",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi Mark, please find attached Rev B of the screen underflow tank GA. Regards, Jo",
    "--ALT",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64utf8(html)),
    "--ALT--",
    "--REL",
    "Content-Type: image/png; name=image001.png",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <logo01@acme>",
    'Content-Disposition: inline; filename="image001.png"',
    "",
    wrap(ASSETS.logo),
    "--REL",
    "Content-Type: image/png; name=image002.png",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <shot01@acme>",
    'Content-Disposition: inline; filename="image002.png"',
    "",
    wrap(ASSETS.shot),
    "--REL--",
    "--MIX",
    'Content-Type: application/pdf; name="UFT-001 GA rev B.pdf"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="UFT-001 GA rev B.pdf"',
    "",
    wrap(ASSETS.pdf),
    "--MIX",
    'Content-Type: text/csv; name="Equipment list rev B.csv"',
    'Content-Disposition: attachment; filename="Equipment list rev B.csv"',
    "",
    "Tag,Description,Rev\r\nUFT-001,Screen underflow tank,B\r\nPP-014,Underflow pump,A",
    "--MIX",
    'Content-Type: image/jpeg; name="Tank pad photo.jpg"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="Tank pad photo.jpg"',
    "",
    wrap(ASSETS.photo),
    "--MIX",
    "Content-Type: message/rfc822",
    "Content-Disposition: attachment",
    "",
    inner,
    "--MIX--",
    "",
  ].join("\r\n");
}

function minutesEmail() {
  return [
    "From: Sam Lee <sam@client.example>",
    "To: Mark Rankin <mark@example.com>",
    "Subject: Site meeting minutes: 29/10 *DRAFT*",
    "Date: Thu, 29 Oct 2026 17:05:00 +1000",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi all,",
    "",
    "Draft minutes from today's site meeting:",
    "1. Crusher feed chute - DP to issue Rev C by 6 Nov.",
    "2. Access platform - client to confirm handrail spec.",
    "",
    "Sam",
    "",
  ].join("\r\n");
}

export const SAMPLES = [
  { id: "vendor", label: "Vendor email with attachments", from: "Jo Citizen", eml: vendorEmail() },
  { id: "minutes", label: "Plain text, no attachments", from: "Sam Lee", eml: minutesEmail() },
];
