"""
DocControl v1.1
---------------
Drop DocControl_v1.1.exe into an inbox folder of saved emails (*.eml, *.msg)
and run it.

For every email in the same folder as the exe it:
  1. reads the sent date and subject,
  2. creates a folder named  YYYYMMDD_SUBJECT  ONE LEVEL UP - i.e. alongside
     the folder the exe sits in (v1.1 change),
  3. saves a PDF of the email (header block + body) into that folder,
  4. saves every attachment into that folder,
  5. moves the original email file into that folder.

Emails that cannot be processed are moved to  _DocControl_ERRORS  so that no
.eml / .msg files are left beside the exe. A log is appended to
DocControl_log.txt in the same folder.

PDF engine: Microsoft Edge (or Chrome) in headless mode - present on every
Windows 10/11 machine - gives a faithful render of HTML emails. If neither
browser is found, a plain-text PDF is produced with the built-in fallback.
"""

__version__ = "1.1"

import base64
import datetime as dt
import email
import email.policy
import email.utils
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

APP = f"DocControl v{__version__}"
ERROR_DIR = "_DocControl_ERRORS"
LOG_NAME = "DocControl_log.txt"
MAX_SUBJECT = 80           # longest subject used in a folder name
MAX_ATTACH_NAME = 120
MAX_PATH_LEN = 250         # Windows' classic limit is 260; keep a margin
MAX_FOLDER_LEN = 170       # full folder path, leaves room for file names
ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10))}


# ----------------------------------------------------------------- helpers --
def base_dir() -> Path:
    """Folder the exe (or script) lives in - NOT the current working dir."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


class Log:
    def __init__(self, folder: Path):
        self.path = folder / LOG_NAME
        self.lines = []

    def __call__(self, msg: str):
        stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{stamp}] {msg}"
        print(line, flush=True)
        self.lines.append(line)

    def flush(self):
        try:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write("\n".join(self.lines) + "\n\n")
        except OSError:
            pass


def clean_name(text: str, max_len: int, fallback: str) -> str:
    """Make a string safe as a Windows file/folder name."""
    text = (text or "").replace("\r", " ").replace("\n", " ").replace("\t", " ")
    text = ILLEGAL.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text[:max_len].rstrip(" .")
    if not text:
        text = fallback
    if text.upper().split(".")[0] in RESERVED:
        text = "_" + text
    return text


def fit_path(folder: Path, name: str) -> Path:
    """Shorten a file name so folder/name stays under MAX_PATH_LEN characters."""
    target = folder / name
    over = len(str(target)) - MAX_PATH_LEN
    if over > 0:
        stem, suffix = Path(name).stem, Path(name).suffix
        stem = stem[:max(8, len(stem) - over)].rstrip(" .")
        target = folder / f"{stem}{suffix}"
    return target


def unique_path(path: Path) -> Path:
    """Return path, or path with _2, _3 ... appended if it already exists."""
    if not path.exists():
        return path
    stem, suffix, n = path.stem, path.suffix, 2
    while True:
        cand = path.with_name(f"{stem}_{n}{suffix}")
        if not cand.exists():
            return cand
        n += 1


def unique_dir(path: Path) -> Path:
    if not path.exists():
        return path
    n = 2
    while True:
        cand = path.with_name(f"{path.name}_{n:02d}")
        if not cand.exists():
            return cand
        n += 1


def to_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        for enc in ("utf-8", "cp1252", "latin-1"):
            try:
                return value.decode(enc)
            except UnicodeDecodeError:
                continue
    return str(value)


def html_to_text(src: str) -> str:
    src = re.sub(r"(?is)<(script|style|head).*?</\1>", "", src)
    src = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>|</h\d>", "\n", src)
    src = re.sub(r"<[^>]+>", "", src)
    src = html.unescape(src)
    return re.sub(r"\n{3,}", "\n\n", src).strip()


# ---------------------------------------------------------------- parsing --
class Parsed:
    """Common shape for an email regardless of .eml or .msg origin."""
    def __init__(self):
        self.date = None          # datetime or None
        self.subject = ""
        self.sender = ""
        self.to = ""
        self.cc = ""
        self.html = ""            # html body (may be empty)
        self.text = ""            # plain body (may be empty)
        self.inline = {}          # content-id -> (mime, bytes) for cid: images
        self.save_attachments = None   # callable(folder) -> list[str]


def parse_eml(path: Path) -> Parsed:
    with open(path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=email.policy.default)

    p = Parsed()
    p.subject = to_text(msg.get("subject", ""))
    p.sender = to_text(msg.get("from", ""))
    p.to = to_text(msg.get("to", ""))
    p.cc = to_text(msg.get("cc", ""))
    raw_date = msg.get("date")
    if raw_date:
        try:
            p.date = email.utils.parsedate_to_datetime(str(raw_date))
        except (TypeError, ValueError):
            p.date = None

    body_html = msg.get_body(preferencelist=("html",))
    body_text = msg.get_body(preferencelist=("plain",))
    try:
        p.html = body_html.get_content() if body_html else ""
    except Exception:
        p.html = to_text(body_html.get_payload(decode=True)) if body_html else ""
    try:
        p.text = body_text.get_content() if body_text else ""
    except Exception:
        p.text = to_text(body_text.get_payload(decode=True)) if body_text else ""

    attachments = []
    for part in msg.walk():
        if part.is_multipart() and part.get_content_type() != "message/rfc822":
            continue
        if part in (body_html, body_text):
            continue
        ctype = part.get_content_type()
        cid = (part.get("Content-ID") or "").strip("<> ")
        fname = part.get_filename()
        disp = part.get_content_disposition()
        if ctype == "message/rfc822":
            inner = part.get_payload()
            inner = inner[0] if isinstance(inner, list) else inner
            data = inner.as_bytes() if hasattr(inner, "as_bytes") else b""
            name = fname or (to_text(inner.get("subject", "attached")) + ".eml")
            attachments.append((name, data))
            continue
        data = part.get_payload(decode=True)
        if data is None:
            continue
        if cid and ctype.startswith("image/"):
            p.inline[cid] = (ctype, data)
        # Save anything that is a real attachment, or a named inline file.
        if disp == "attachment" or fname:
            ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif"
                   }.get(ctype, ".bin")
            attachments.append((fname or f"attachment{ext}", data))

    def save(folder: Path):
        saved = []
        for name, data in attachments:
            target = unique_path(fit_path(folder, clean_name(name, MAX_ATTACH_NAME, "attachment")))
            target.write_bytes(data)
            saved.append(target.name)
        return saved

    p.save_attachments = save
    return p


def parse_msg(path: Path):
    """Returns (Parsed, closer). The .msg must be closed before it is moved."""
    import extract_msg
    from extract_msg.enums import ErrorBehavior
    tolerant = ErrorBehavior(0)
    for flag in ErrorBehavior:          # be forgiving of slightly malformed files
        tolerant |= flag
    msg = extract_msg.openMsg(str(path), errorBehavior=tolerant)

    p = Parsed()
    p.subject = to_text(getattr(msg, "subject", ""))
    p.sender = to_text(getattr(msg, "sender", ""))
    p.to = to_text(getattr(msg, "to", ""))
    p.cc = to_text(getattr(msg, "cc", ""))
    d = getattr(msg, "date", None)
    if isinstance(d, dt.datetime):
        p.date = d
    elif d:
        try:
            p.date = email.utils.parsedate_to_datetime(str(d))
        except (TypeError, ValueError):
            p.date = None

    try:
        p.html = to_text(msg.htmlBody) if getattr(msg, "htmlBody", None) else ""
    except Exception:
        p.html = ""
    try:
        p.text = to_text(msg.body) if getattr(msg, "body", None) else ""
    except Exception:
        p.text = ""

    atts = list(getattr(msg, "attachments", []) or [])
    for a in atts:
        cid = (getattr(a, "cid", None) or getattr(a, "contentId", None) or "").strip("<> ")
        data = getattr(a, "data", None)
        mime = getattr(a, "mimetype", None) or "application/octet-stream"
        if cid and isinstance(data, (bytes, bytearray)):
            p.inline[cid] = (mime, bytes(data))

    def save(folder: Path):
        saved = []
        for i, a in enumerate(atts, 1):
            data = getattr(a, "data", None)
            raw = (getattr(a, "longFilename", None) or getattr(a, "shortFilename", None)
                   or getattr(a, "displayName", None) or f"attachment_{i}")
            if isinstance(data, (bytes, bytearray)):
                target = unique_path(fit_path(folder, clean_name(raw, MAX_ATTACH_NAME, f"attachment_{i}")))
                target.write_bytes(bytes(data))
                saved.append(target.name)
            else:
                # Embedded Outlook item (an email attached to the email): save as .msg
                try:
                    name = clean_name(Path(raw).stem, MAX_ATTACH_NAME - 4, f"attachment_{i}") + ".msg"
                    target = unique_path(fit_path(folder, name))
                    a.save(customPath=str(folder), customFilename=target.name,
                           extractEmbedded=True)
                    saved.append(target.name)
                except Exception as e:  # keep going - logged by caller
                    saved.append(f"(could not save '{raw}': {e})")
        return saved

    p.save_attachments = save
    return p, msg.close


# -------------------------------------------------------------------- PDF --
def build_html(p: Parsed, attachment_names) -> str:
    def row(label, value):
        if not value:
            return ""
        return (f"<tr><td class='k'>{label}</td>"
                f"<td>{html.escape(value)}</td></tr>")

    sent = p.date.strftime("%A, %d %B %Y %I:%M %p") if p.date else "(no date)"
    header = ("<table class='hdr'>"
              + row("From:", p.sender) + row("Sent:", sent) + row("To:", p.to)
              + row("Cc:", p.cc) + row("Subject:", p.subject or "(no subject)")
              + row("Attachments:", "; ".join(n for n in attachment_names if not n.startswith("(")))
              + "</table><hr>")

    if p.html:
        body = p.html
        for cid, (mime, data) in p.inline.items():
            uri = f"data:{mime};base64,{base64.b64encode(data).decode()}"
            body = re.sub(rf"cid:{re.escape(cid)}", uri, body, flags=re.I)
        # Pull out the <body> contents if this is a full document.
        m = re.search(r"(?is)<body[^>]*>(.*)</body>", body)
        body = m.group(1) if m else body
    else:
        body = f"<pre class='plain'>{html.escape(p.text)}</pre>"

    return f"""<!doctype html><html><head><meta charset="utf-8">
<style>
 @page {{ size: A4; margin: 15mm; }}
 body {{ font-family: Calibri, Arial, sans-serif; font-size: 11pt; }}
 table.hdr td {{ vertical-align: top; padding: 1px 6px 1px 0; font-size: 10.5pt; }}
 table.hdr td.k {{ font-weight: bold; white-space: nowrap; }}
 pre.plain {{ white-space: pre-wrap; font-family: Calibri, Arial, sans-serif; }}
 img {{ max-width: 100%; }}
</style></head><body>{header}{body}</body></html>"""


def find_browser():
    candidates = []
    for env in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        root = os.environ.get(env)
        if root:
            candidates += [Path(root) / "Microsoft/Edge/Application/msedge.exe",
                           Path(root) / "Google/Chrome/Application/chrome.exe"]
    for c in candidates:
        if c.exists():
            return str(c)
    for name in ("msedge", "chromium", "chromium-browser", "google-chrome", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def pdf_via_browser(browser: str, html_doc: str, out_pdf: Path) -> bool:
    with tempfile.TemporaryDirectory(prefix="doccontrol_") as tmp:
        src = Path(tmp) / "email.html"
        src.write_text(html_doc, encoding="utf-8")
        tmp_pdf = Path(tmp) / "out.pdf"
        cmd = [browser, "--headless", "--disable-gpu", "--no-first-run",
               "--no-pdf-header-footer", "--print-to-pdf-no-header",
               f"--user-data-dir={Path(tmp) / 'profile'}",
               f"--print-to-pdf={tmp_pdf}", src.as_uri()]
        flags = 0x08000000 if os.name == "nt" else 0   # CREATE_NO_WINDOW
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=90, creationflags=flags)
        except (subprocess.TimeoutExpired, OSError):
            return False
        for _ in range(20):                       # brief wait for file flush
            if tmp_pdf.exists() and tmp_pdf.stat().st_size > 0:
                shutil.copyfile(tmp_pdf, out_pdf)
                return True
            time.sleep(0.25)
    return False


def pdf_via_fpdf(p: Parsed, attachment_names, out_pdf: Path):
    from fpdf import FPDF
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, margin=15)
    pdf.add_page()
    font = "Helvetica"
    for ttf in (r"C:\Windows\Fonts\arial.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(ttf):
            pdf.add_font("Body", "", ttf)
            bold = ttf.replace("arial.ttf", "arialbd.ttf").replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf")
            pdf.add_font("Body", "B", bold if os.path.exists(bold) else ttf)
            font = "Body"
            break

    def safe(s):
        return s if font == "Body" else s.encode("latin-1", "replace").decode("latin-1")

    sent = p.date.strftime("%A, %d %B %Y %I:%M %p") if p.date else "(no date)"
    fields = [("From:", p.sender), ("Sent:", sent), ("To:", p.to), ("Cc:", p.cc),
              ("Subject:", p.subject or "(no subject)"),
              ("Attachments:", "; ".join(n for n in attachment_names if not n.startswith("(")))]
    for k, v in fields:
        if not v:
            continue
        pdf.set_font(font, "B", 10)
        pdf.cell(28, 6, k)
        pdf.set_font(font, "", 10)
        pdf.multi_cell(0, 6, safe(v), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(4)
    body = p.text or html_to_text(p.html)
    pdf.set_font(font, "", 10.5)
    pdf.multi_cell(0, 5.5, safe(body or "(no body)"), new_x="LMARGIN", new_y="NEXT")
    pdf.output(str(out_pdf))


# ------------------------------------------------------------------- main --
def process(path: Path, root: Path, out_root: Path, browser, log: Log) -> bool:
    closer = None
    try:
        if path.suffix.lower() == ".msg":
            p, closer = parse_msg(path)
        else:
            p = parse_eml(path)

        if p.date is None:
            p.date = dt.datetime.fromtimestamp(path.stat().st_mtime)
            log(f"   ! no date in email - used file modified date {p.date:%Y-%m-%d}")
        # Convert to this PC's time zone so the folder date matches what you saw in Outlook.
        if p.date.tzinfo is not None:
            p.date = p.date.astimezone()
        prefix = p.date.strftime("%Y%m%d")
        # Trim the subject if the destination path is long (e.g. deep OneDrive folders).
        room = MAX_FOLDER_LEN - len(str(out_root)) - len(prefix) - 5
        subject = clean_name(p.subject, max(20, min(MAX_SUBJECT, room)), "NO SUBJECT")
        folder = unique_dir(out_root / f"{prefix}_{subject}")
        folder.mkdir(parents=True)

        names = p.save_attachments(folder)
        for n in names:
            if n.startswith("("):
                log(f"   ! attachment {n}")

        pdf_path = unique_path(fit_path(folder, f"{prefix}_{subject}.pdf"))
        ok = False
        if browser:
            ok = pdf_via_browser(browser, build_html(p, names), pdf_path)
        if not ok:
            pdf_via_fpdf(p, names, pdf_path)
            if browser:
                log("   ! browser PDF failed - plain-text PDF used instead")

        if closer:
            closer()
            closer = None
        shutil.move(str(path), str(unique_path(fit_path(folder, path.name))))
        log(f"OK  {path.name}  ->  {folder.name}\\  "
            f"(PDF + {len([n for n in names if not n.startswith('(')])} attachment(s))")
        return True
    except Exception as e:
        log(f"ERR {path.name}: {e}")
        log("   " + traceback.format_exc().strip().replace("\n", "\n   "))
        try:
            if closer:
                closer()
        except Exception:
            pass
        try:
            err_dir = root / ERROR_DIR
            err_dir.mkdir(exist_ok=True)
            shutil.move(str(path), str(unique_path(err_dir / path.name)))
            log(f"    moved to {ERROR_DIR}\\ for manual review")
        except Exception as e2:
            log(f"    could not move to {ERROR_DIR}: {e2}")
        return False


def main():
    root = base_dir()
    out_root = root.parent          # email folders go one level up, beside the exe's folder
    log = Log(root)
    log(f"{APP} - processing folder: {root}")
    log(f"Filing emails into:  {out_root}")
    emails = sorted(f for f in root.iterdir()
                    if f.is_file() and f.suffix.lower() in (".eml", ".msg"))
    if not emails:
        log("No .eml or .msg files found.")
    else:
        browser = find_browser()
        log(f"PDF engine: {browser or 'built-in plain-text fallback'}")
        ok = sum(process(e, root, out_root, browser, log) for e in emails)
        log(f"Done. {ok} of {len(emails)} email(s) filed"
            + (f", {len(emails) - ok} moved to {ERROR_DIR}" if ok < len(emails) else "") + ".")
        left = [f.name for f in root.iterdir()
                if f.is_file() and f.suffix.lower() in (".eml", ".msg")]
        if left:
            log("WARNING - still in folder: " + ", ".join(left))
    log.flush()
    if "--nopause" not in sys.argv and sys.stdin and sys.stdin.isatty():
        input("\nPress Enter to close...")


if __name__ == "__main__":
    main()
