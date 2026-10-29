// Entry point inside Outlook.
/* global Office */
import { CONFIG } from "./config.js";
import { Graph } from "./graph.js";
import { authSupported, makeTokenGetter } from "./auth.js";
import { itemMime, currentItem } from "./outlook.js";
import { renderPdf } from "./pdf-client.js";
import { startUI } from "./ui.js";

Office.onReady(() => {
  let graph = null, setupProblem = null;
  if (!CONFIG.clientId) {
    setupProblem = "<b>Not set up yet.</b> The add-in has no app registration (client ID). See the setup guide, step 1.";
  } else if (!authSupported()) {
    setupProblem = "<b>This version of Outlook can't sign in to add-ins.</b> Update Microsoft 365, or use new Outlook / Outlook on the web.";
  } else {
    graph = new Graph(makeTokenGetter(CONFIG));
  }

  startUI({
    root: document.getElementById("app"),
    cfg: CONFIG,
    logoSrc: "assets/DesignProcess_logo_white_v1.png",
    testBuild: true,
    graph, setupProblem,
    renderPdf,
    host: {
      async load(g) {
        const it = currentItem();
        if (!it) throw new Error("No email selected.");
        if (!g && typeof it.getAsFileAsync !== "function") throw new Error("Sign-in is needed to read this email.");
        return { mime: await itemMime(g), fallbackDate: it.dateTimeCreated };
      },
      onItemChanged(cb) {
        try { Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, () => cb()); } catch { /* not pinnable here */ }
      },
    },
  });
});
