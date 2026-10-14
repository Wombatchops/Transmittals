DocControl v2.0 - email filing tool
====================================

WHAT IT DOES
Put DocControl_v2.0.exe in a folder of saved emails (.eml / .msg) and double-click it.
For each email it creates a folder  YYYYMMDD_SUBJECT  ONE LEVEL UP (alongside the
folder the exe is in) and puts in it:
  - the original email, renamed to match the folder (YYYYMMDD_SUBJECT.msg) and moved in
  - a PDF of the email  (From / Sent / To / Cc / Subject / Attachments header + body)
  - every attachment (embedded images are printed in the PDF, not saved separately)
When finished, no .eml or .msg files remain beside the exe.

RULES IT FOLLOWS
  - Date = email's sent date, converted to this PC's time zone.
    No date in the email -> file's modified date is used (noted in the log).
  - Characters Windows won't allow in names ( \ / : * ? " < > | ) are removed.
    Subject is trimmed to 80 characters, or shorter if the folder path is long
    (e.g. deep OneDrive folders), to stay under Windows' 260-character path limit.
  - Blank subject -> "NO SUBJECT".
  - Folder already exists (same date + subject, or re-run) -> _02, _03 ... is added.
    Nothing is ever overwritten.
  - Emails attached to emails are saved as .eml / .msg files.
  - Images embedded in the email body (logos, signatures, pasted screenshots) are
    printed in the PDF and not saved as files. Images sent as real attachments are saved.
  - Once an email's folder is created, the email always goes into it - if the PDF or
    an attachment has a problem it is noted in the log as a warning.
  - Only an email that can't be read at all goes to  _DocControl_ERRORS  (beside the exe).
  - Every run is appended to  DocControl_log.txt  in the same folder.

PDF QUALITY
Uses Microsoft Edge (built into Windows 10/11) in the background for a faithful
render of formatted emails. If Edge/Chrome can't be found, a plain-text PDF is made.
Note: Edge will load any web-hosted images referenced in the email while printing.

BUILDING THE EXE (one-off)
  1. Install Python 3.10+ from python.org (tick "Add python.exe to PATH").
  2. Put these 3 files in one folder and double-click BUILD_DocControl_v2.0.bat:
       DocControl_v2.0.py, requirements_v2.0.txt, BUILD_DocControl_v2.0.bat
  3. DocControl_v2.0.exe appears in that folder (~25-30 MB). Python is no longer needed
     to run it; copy the exe to any PC.

Windows SmartScreen may warn on first run because the exe isn't code-signed:
"More info" -> "Run anyway". Some corporate antivirus flags unsigned PyInstaller exes;
whitelist it if so.

OPTIONS
  DocControl_v2.0.exe --nopause     (don't wait for Enter at the end; for scheduled runs)

CHANGES
  v2.0  Email renamed to YYYYMMDD_SUBJECT and always moved into its folder.
        Embedded images printed in the PDF, no longer saved as separate files.
        .msg read into memory and moves retried, to avoid OneDrive/Windows file locks.
  v1.1  Email folders are created one level up from the exe's folder.
        File/folder names shortened automatically when the path would exceed 250 chars.
  v1.0  First release.
