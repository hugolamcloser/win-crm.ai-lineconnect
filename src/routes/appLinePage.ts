import crypto from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { HttpError } from "../middleware/errors";
import { requireSharedSecret } from "../middleware/sharedSecret";
import {
  connectLineChannel,
  disconnectLineChannel,
  getLineConnectionSettings,
  type LineConnectionSettings
} from "../services/lineConnectionService";

type PageAction = "connect" | "disconnect";

type SignedPagePayload = {
  kind: "page_access" | "page_action";
  action?: PageAction;
  locationId: string;
  expiresAt: number;
  nonce: string;
};

const tokenTtlMs = 15 * 60 * 1000;

const pageFormBodyParser = express.urlencoded({ extended: false, limit: "32kb" });
const pageLinkBodySchema = z.object({ locationId: z.string().min(1) });
const pageQuerySchema = z.object({
  locationId: z.string().min(1),
  pageToken: z.string().min(1),
  status: z.string().optional()
});
const pageConnectBodySchema = z.object({
  locationId: z.string().min(1),
  pageToken: z.string().min(1),
  actionToken: z.string().min(1),
  channelAccessToken: z.string().min(1),
  channelSecret: z.string().min(1)
});
const pageDisconnectBodySchema = z.object({
  locationId: z.string().min(1),
  pageToken: z.string().min(1),
  actionToken: z.string().min(1)
});

export const appLinePageRouter = Router();

function getPublicBaseUrl(req: Request): string {
  return env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function getPageSigningSecret(): string {
  const secret = env.WEBHOOK_SHARED_SECRET.trim();

  if (!secret) {
    throw new HttpError(503, "App page signing secret is not configured");
  }

  return secret;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getReadableError(error: unknown): string {
  if (error instanceof HttpError) {
    return error.message;
  }

  if (error instanceof z.ZodError) {
    return "Please fill in all required fields.";
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

function signPayload(payloadText: string): string {
  return crypto.createHmac("sha256", getPageSigningSecret()).update(payloadText).digest("base64url");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSignedToken(input: {
  kind: SignedPagePayload["kind"];
  locationId: string;
  action?: PageAction;
}): { token: string; expiresAt: string } {
  const expiresAt = Date.now() + tokenTtlMs;
  const payload: SignedPagePayload = {
    kind: input.kind,
    action: input.action,
    locationId: input.locationId,
    expiresAt,
    nonce: crypto.randomBytes(16).toString("hex")
  };
  const payloadText = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return {
    token: `${payloadText}.${signPayload(payloadText)}`,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

function readSignedToken(token: string, expectedKind: SignedPagePayload["kind"]): SignedPagePayload {
  const [payloadText, signature] = token.split(".");

  if (!payloadText || !signature || !timingSafeStringEqual(signature, signPayload(payloadText))) {
    throw new HttpError(401, "Invalid page token");
  }

  let payload: SignedPagePayload;

  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8")) as SignedPagePayload;
  } catch {
    throw new HttpError(401, "Invalid page token");
  }

  if (payload.kind !== expectedKind || payload.expiresAt < Date.now()) {
    throw new HttpError(401, "Invalid page token");
  }

  return payload;
}

function verifyPageAccessToken(token: string, locationId: string): void {
  const payload = readSignedToken(token, "page_access");

  if (payload.locationId !== locationId) {
    throw new HttpError(401, "Invalid page token");
  }
}

function verifyPageActionToken(token: string, locationId: string, action: PageAction): void {
  const payload = readSignedToken(token, "page_action");

  if (payload.locationId !== locationId || payload.action !== action) {
    throw new HttpError(401, "Invalid page action token");
  }
}

function buildPageUrl(req: Request, locationId: string, pageToken: string): string {
  return `${getPublicBaseUrl(req).replace(/\/+$/, "")}/app/line/page?locationId=${encodeURIComponent(
    locationId
  )}&pageToken=${encodeURIComponent(pageToken)}`;
}

function setPageHeaders(res: Response, scriptNonce: string): void {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "base-uri 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "img-src 'self' data:",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${scriptNonce}'`,
      "frame-ancestors 'self' https://app.gohighlevel.com https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.leadconnectorhq.com"
    ].join("; ")
  );
}

async function renderLinePage(
  req: Request,
  res: Response,
  input: {
    locationId: string;
    pageToken: string;
    statusMessage?: string;
    errorMessage?: string;
  }
): Promise<void> {
  verifyPageAccessToken(input.pageToken, input.locationId);

  const settings = await getLineConnectionSettings({
    locationId: input.locationId,
    publicBaseUrl: getPublicBaseUrl(req)
  });
  const scriptNonce = crypto.randomBytes(16).toString("base64url");

  setPageHeaders(res, scriptNonce);
  res.status(input.errorMessage ? 400 : 200).send(
    buildLinePageHtml({
      ...input,
      settings,
      scriptNonce,
      connectActionToken: createSignedToken({
        kind: "page_action",
        locationId: input.locationId,
        action: "connect"
      }).token,
      disconnectActionToken: createSignedToken({
        kind: "page_action",
        locationId: input.locationId,
        action: "disconnect"
      }).token
    })
  );
}

function buildLinePageHtml(input: {
  locationId: string;
  pageToken: string;
  settings: LineConnectionSettings;
  connectActionToken: string;
  disconnectActionToken: string;
  scriptNonce: string;
  statusMessage?: string;
  errorMessage?: string;
}): string {
  const webhookUrl = input.settings.webhook_url ?? "";
  const statusLabel = input.settings.connected ? "Connected" : "Not connected";
  const statusClass = input.settings.connected ? "connected" : "disconnected";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LINE Connection</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--border:#dfe3ea;--text:#162033;--muted:#667085;--line:#06c755;--line-dark:#049746;--danger:#ba1a1a;--ok:#edfdf4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(920px,calc(100vw - 32px));margin:0 auto;padding:28px 0}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}h1,h2{margin:0;letter-spacing:0}h1{font-size:24px;line-height:1.2}h2{font-size:16px;margin-bottom:14px}.tenant,.help{color:var(--muted);font-size:13px}.tenant{margin-top:4px;word-break:break-all}.pill{border:1px solid var(--border);border-radius:999px;padding:6px 12px;background:#fff;font-size:13px;font-weight:700;white-space:nowrap}.pill.connected{color:#067647;border-color:#abefc6;background:var(--ok)}.pill.disconnected{color:#7a4b00;border-color:#fedf89;background:#fffaeb}.panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:20px;margin-bottom:16px;box-shadow:0 12px 30px rgba(21,28,43,.08)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.metric{border:1px solid var(--border);border-radius:8px;padding:14px}.metric-label{color:var(--muted);font-size:12px;margin-bottom:6px}.metric-value{font-size:18px;font-weight:700;word-break:break-word}.field{margin-bottom:14px}label{display:block;color:#344054;font-weight:700;font-size:13px;margin-bottom:6px}input,textarea{width:100%;border:1px solid var(--border);border-radius:8px;padding:11px 12px;font:inherit;color:var(--text);background:#fff}textarea{min-height:96px;resize:vertical}input[readonly]{background:#f9fafb}.inline{display:flex;gap:10px}.inline input{min-width:0}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}button{border:0;border-radius:8px;padding:10px 14px;min-height:42px;font:inherit;font-weight:700;cursor:pointer}.primary{background:var(--line);color:#fff}.primary:hover{background:var(--line-dark)}.secondary{background:#eef2f6;color:var(--text)}.danger{background:var(--danger);color:#fff}button:disabled{cursor:not-allowed;opacity:.55}.notice,.error{border-radius:8px;padding:12px 14px;margin-bottom:16px}.notice{border:1px solid #abefc6;background:var(--ok);color:#05603a}.error{border:1px solid #fecdca;background:#fff1f0;color:var(--danger)}@media(max-width:720px){main{width:min(100vw - 24px,920px);padding:20px 0}.topbar{flex-direction:column}.grid{grid-template-columns:1fr}.inline{flex-direction:column}}
</style>
</head>
<body>
<main>
  <div class="topbar">
    <div><h1>LINE Connection</h1><div class="tenant">Location ${escapeHtml(input.locationId)}</div></div>
    <span class="pill ${statusClass}">${statusLabel}</span>
  </div>
  ${input.statusMessage ? `<div class="notice">${escapeHtml(input.statusMessage)}</div>` : ""}
  ${input.errorMessage ? `<div class="error">${escapeHtml(input.errorMessage)}</div>` : ""}
  <section class="panel">
    <h2>Connection</h2>
    <div class="grid">
      <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${statusLabel}</div></div>
      <div class="metric"><div class="metric-label">Access token length</div><div class="metric-value">${input.settings.channel_access_token_length}</div></div>
      <div class="metric"><div class="metric-label">Channel secret length</div><div class="metric-value">${input.settings.channel_secret_length}</div></div>
    </div>
  </section>
  <section class="panel">
    <h2>Webhook URL</h2>
    <div class="inline">
      <input id="webhook-url" readonly value="${escapeHtml(webhookUrl)}" placeholder="Connect LINE to generate a webhook URL">
      <button class="secondary" type="button" id="copy-webhook" ${webhookUrl ? "" : "disabled"}>Copy</button>
    </div>
    <p class="help">Paste this URL into LINE Developers as the Messaging API webhook URL.</p>
  </section>
  <section class="panel">
    <h2>Connect LINE Official Account</h2>
    <form method="post" action="/app/line/page/connect" autocomplete="off">
      <input type="hidden" name="locationId" value="${escapeHtml(input.locationId)}">
      <input type="hidden" name="pageToken" value="${escapeHtml(input.pageToken)}">
      <input type="hidden" name="actionToken" value="${escapeHtml(input.connectActionToken)}">
      <div class="field"><label for="channel-access-token">Channel access token</label><textarea id="channel-access-token" name="channelAccessToken" required spellcheck="false" autocomplete="off"></textarea></div>
      <div class="field"><label for="channel-secret">Channel secret</label><input id="channel-secret" name="channelSecret" type="password" required autocomplete="off"></div>
      <div class="actions"><button class="primary" type="submit">Connect LINE</button></div>
    </form>
  </section>
  <section class="panel">
    <h2>Disconnect</h2>
    <form method="post" action="/app/line/page/disconnect">
      <input type="hidden" name="locationId" value="${escapeHtml(input.locationId)}">
      <input type="hidden" name="pageToken" value="${escapeHtml(input.pageToken)}">
      <input type="hidden" name="actionToken" value="${escapeHtml(input.disconnectActionToken)}">
      <div class="actions"><button class="danger" type="submit" ${input.settings.connected ? "" : "disabled"}>Disconnect LINE</button></div>
    </form>
  </section>
</main>
<script nonce="${input.scriptNonce}">
const copyButton=document.getElementById("copy-webhook");
const webhookInput=document.getElementById("webhook-url");
copyButton?.addEventListener("click",async()=>{if(!webhookInput?.value)return;try{await navigator.clipboard.writeText(webhookInput.value)}catch{webhookInput.select();document.execCommand("copy")}copyButton.textContent="Copied";window.setTimeout(()=>{copyButton.textContent="Copy"},1500)});
</script>
</body>
</html>`;
}

appLinePageRouter.post("/app/line/page-link", requireSharedSecret, async (req, res, next) => {
  try {
    const input = pageLinkBodySchema.parse(req.body);
    const { token, expiresAt } = createSignedToken({ kind: "page_access", locationId: input.locationId });

    res.json({
      page_url: buildPageUrl(req, input.locationId, token),
      expires_at: expiresAt
    });
  } catch (error) {
    next(error);
  }
});

appLinePageRouter.get("/app/line/page", async (req, res, next) => {
  try {
    const query = pageQuerySchema.parse(req.query);

    await renderLinePage(req, res, {
      locationId: query.locationId,
      pageToken: query.pageToken,
      statusMessage: query.status
    });
  } catch (error) {
    next(error);
  }
});

appLinePageRouter.post("/app/line/page/connect", pageFormBodyParser, async (req, res, next) => {
  try {
    const input = pageConnectBodySchema.parse(req.body);
    verifyPageAccessToken(input.pageToken, input.locationId);
    verifyPageActionToken(input.actionToken, input.locationId, "connect");

    await connectLineChannel({
      locationId: input.locationId,
      channelAccessToken: input.channelAccessToken,
      channelSecret: input.channelSecret,
      publicBaseUrl: getPublicBaseUrl(req)
    });

    const { token } = createSignedToken({ kind: "page_access", locationId: input.locationId });
    res.redirect(303, `${buildPageUrl(req, input.locationId, token)}&status=LINE%20connected`);
  } catch (error) {
    try {
      const locationId = typeof req.body?.locationId === "string" && req.body.locationId.trim() ? req.body.locationId : "";
      const pageToken = typeof req.body?.pageToken === "string" ? req.body.pageToken : "";

      await renderLinePage(req, res, { locationId, pageToken, errorMessage: getReadableError(error) });
    } catch (renderError) {
      next(renderError);
    }
  }
});

appLinePageRouter.post("/app/line/page/disconnect", pageFormBodyParser, async (req, res, next) => {
  try {
    const input = pageDisconnectBodySchema.parse(req.body);
    verifyPageAccessToken(input.pageToken, input.locationId);
    verifyPageActionToken(input.actionToken, input.locationId, "disconnect");

    await disconnectLineChannel({
      locationId: input.locationId,
      publicBaseUrl: getPublicBaseUrl(req)
    });

    const { token } = createSignedToken({ kind: "page_access", locationId: input.locationId });
    res.redirect(303, `${buildPageUrl(req, input.locationId, token)}&status=LINE%20disconnected`);
  } catch (error) {
    try {
      const locationId = typeof req.body?.locationId === "string" && req.body.locationId.trim() ? req.body.locationId : "";
      const pageToken = typeof req.body?.pageToken === "string" ? req.body.pageToken : "";

      await renderLinePage(req, res, { locationId, pageToken, errorMessage: getReadableError(error) });
    } catch (renderError) {
      next(renderError);
    }
  }
});
