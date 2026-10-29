// In-browser PDF: renders the email (header + body) and paginates it onto A4.
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const PAGE_W = 794;           // A4 width in CSS px at 96 dpi
const PAGE_H = 1123;          // A4 height in CSS px

export async function renderPdf(html) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: PAGE_W + "px", height: "800px", border: "0" });
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    doc.open(); doc.write(html); doc.close();
    await new Promise((r) => (doc.readyState === "complete" ? r() : frame.addEventListener("load", r, { once: true })));
    await Promise.all([...doc.images].map((img) => img.complete ? null :
      new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 8000); })));
    const body = doc.body;
    const height = Math.max(body.scrollHeight, 200);
    frame.style.height = height + "px";

    const scale = 2;
    const canvas = await html2canvas(body, { scale, useCORS: true, allowTaint: false, backgroundColor: "#ffffff",
      width: PAGE_W, windowWidth: PAGE_W, height, windowHeight: height, logging: false });

    const pdf = new jsPDF({ unit: "px", format: [PAGE_W, PAGE_H], hotfixes: ["px_scaling"], compress: true });
    const sliceH = PAGE_H * scale;
    const pages = Math.max(1, Math.ceil(canvas.height / sliceH));
    const part = document.createElement("canvas");
    part.width = canvas.width;
    for (let i = 0; i < pages; i++) {
      const h = Math.min(sliceH, canvas.height - i * sliceH);
      part.height = h;
      const ctx = part.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, part.width, h);
      ctx.drawImage(canvas, 0, i * sliceH, canvas.width, h, 0, 0, canvas.width, h);
      if (i > 0) pdf.addPage([PAGE_W, PAGE_H]);
      pdf.addImage(part.toDataURL("image/jpeg", 0.88), "JPEG", 0, 0, PAGE_W, h / scale);
    }
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    frame.remove();
  }
}
