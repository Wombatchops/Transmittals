// Reads the selected email from Outlook.

function call(fn) {
  return new Promise((resolve, reject) => fn((r) =>
    r.status === Office.AsyncResultStatus.Succeeded ? resolve(r.value) : reject(new Error(r.error?.message || "Outlook call failed"))));
}

function b64ToBytes(b64) {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function currentItem() {
  return Office.context.mailbox.item;
}

/** Light details for the screen (no download). */
export function itemSummary() {
  const it = currentItem();
  if (!it) return null;
  return {
    subject: it.subject || "",
    from: it.from ? (it.from.displayName || it.from.emailAddress) : "",
    date: it.dateTimeCreated ? new Date(it.dateTimeCreated) : null,
    attachments: (it.attachments || []).filter((a) => !a.isInline).length,
    itemId: it.itemId,
  };
}

/** The whole email as .eml bytes: Outlook first (works for shared mailboxes), Graph as fallback. */
export async function itemMime(graph) {
  const it = currentItem();
  if (typeof it.getAsFileAsync === "function") {
    try { return b64ToBytes(await call((cb) => it.getAsFileAsync(cb))); } catch { /* fall through to Graph */ }
  }
  const restId = Office.context.mailbox.convertToRestId(it.itemId, Office.MailboxEnums.RestVersion.v2_0);
  return graph.messageMime(restId);
}
