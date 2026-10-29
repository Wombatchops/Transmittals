// Sign-in via Nested App Authentication (the Outlook add-in single sign-on method).
import { createNestablePublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";

export const SCOPES = ["Sites.ReadWrite.All", "Mail.Read"];

export function authSupported() {
  try { return Office.context.requirements.isSetSupported("NestedAppAuth", "1.1"); } catch { return false; }
}

export function makeTokenGetter(cfg) {
  let pca = null;
  return async function getToken() {
    if (!pca) {
      pca = await createNestablePublicClientApplication({
        auth: { clientId: cfg.clientId, authority: `https://login.microsoftonline.com/${cfg.tenant}` },
        cache: { cacheLocation: "localStorage" },
      });
    }
    const req = { scopes: SCOPES };
    try {
      const account = pca.getActiveAccount() || pca.getAllAccounts()[0];
      const r = await pca.acquireTokenSilent(account ? { ...req, account } : req);
      return r.accessToken;
    } catch (e) {
      if (!(e instanceof InteractionRequiredAuthError) && !/interaction|consent|login/i.test(String(e?.errorCode || e?.message))) throw e;
      const r = await pca.acquireTokenPopup(req);
      return r.accessToken;
    }
  };
}
