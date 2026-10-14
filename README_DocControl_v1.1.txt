DocControl v1.1 - email filing tool
====================================

WHAT IT DOES
Put DocControl_v1.1.exe in a folder of saved emails (.eml / .msg) and double-click it.
For each email it creates a folder  YYYYMMDD_SUBJECT  ONE LEVEL UP (alongside the
folder the exe is in) and puts in it:
  - the original email file (moved, not copied)
  - a PDF of the email  (From / Sent / To / Cc / Subject / Attachments header + body)
  - every attachment
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
  - Inline images with no file name (e.g. signature logos) appear in the PDF but are
    not saved separately.
  - Any email that fails is moved to  _DocControl_ERRORS  (beside the exe) for review.
  - Every run is appended to  DocControl_log.txt  in the same folder.

PDF QUALITY
Uses Microsoft Edge (built into Windows 10/11) in the background for a faithful
render of formatted emails. If Edge/Chrome can't be found, a plain-text PDF is made.
Note: Edge will load any web-hosted images referenced in the email while printing.

BUILDING THE EXE (one-off)
  1. Install Python 3.10+ from python.org (tick "Add python.exe to PATH").
  2. Put these 3 files in one folder and double-click BUILD_DocControl_v1.1.bat:
       DocControl_v1.1.py, requirements_v1.1.txt, BUILD_DocControl_v1.1.bat
  3. DocControl_v1.1.exe appears in that folder (~25-30 MB). Python is no longer needed
     to run it; copy the exe to any PC.

Windows SmartScreen may warn on first run because the exe isn't code-signed:
"More info" -> "Run anyway". Some corporate antivirus flags unsigned PyInstaller exes;
whitelist it if so.

OPTIONS
  DocControl_v1.1.exe --nopause     (don't wait for Enter at the end; for scheduled runs)

CHANGES
  v1.1  Email folders are created one level up from the exe's folder.
        File/folder names shortened automatically when the path would exceed 250 chars.
  v1.0  First release.
