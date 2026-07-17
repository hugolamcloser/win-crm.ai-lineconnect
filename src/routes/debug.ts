import { Router, type RequestHandler } from "express";
import { env, getEnvPresenceReport } from "../config/env";
import { logger } from "../config/logger";
import { requireSharedSecret } from "../middleware/sharedSecret";
import {
  getGhlInboundSendAuthConfigDebug,
  getGhlProviderConfigDebug,
  testGhlInboundMessageEndpoint,
  testGhlConversationProviderAccess,
  testGhlOAuthToken
} from "../integrations/ghlClient";
import { testGhlInboundMessageAuthMatrix } from "../integrations/ghlInboundAuthMatrix";
import { getGhlInboundSendPayloadDebug, testGhlInboundSendAuth } from "../integrations/ghlInboundMessageClient";
import {
  getConfiguredLocationApiAuthMode,
  getEffectiveInboundSendAuthMode,
  testGhlContactAuth
} from "../integrations/ghlLocationClient";
import {
  getGhlTokenInstallSummary,
  testGhlInboundPayloadMatrix,
  testGhlConversationPermissions
} from "../integrations/ghlConversationPermissionTest";
import {
  getConfiguredGhlOAuthStatus,
  getConfiguredGhlOAuthTokenClaims,
  getOAuthCallbackConfig
} from "../services/ghlOAuthService";
import { getRecentDebugEvents } from "../services/repository";
import { redactSecrets } from "../utils/redaction";
import { isValidWorkflowActionSecret } from "./ghlWebhook";

export const debugRouter = Router();

type ProbeFieldMetadata = {
  present: boolean;
  type: string;
  isArray: boolean;
  arrayLength: number | null;
  objectKeys: string[];
  urlLikeValuePresent: boolean;
  mimeTypePresent: boolean;
  filenamePresent: boolean;
};

type ProbeInspectionState = {
  inspectedNodes: number;
  placeholderIndex: number;
  objectKeys: string[];
  objectKeySet: Set<string>;
  urlLikeValuePresent: boolean;
  mimeTypePresent: boolean;
  filenamePresent: boolean;
  seen: WeakSet<object>;
};

const probeFieldNames = ["message", "imageAttachment", "videoAttachment"] as const;
const probeMaxDepth = 5;
const probeMaxInspectedNodes = 100;
const probeMaxArrayElements = 10;
const probeMaxObjectEntries = 20;
const probeMaxReturnedKeys = 20;

const sensitiveProbeObjectKeys = new Set([
  "authorization",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "secret",
  "signature",
  "signedquery",
  "querystring",
  "filecontent",
  "filecontents",
  "base64",
  "blob",
  "locationid",
  "contactid",
  "workflowid",
  "tenantid",
  "companyid",
  "customerid",
  "conversationid",
  "ghlconversationid",
  "userid",
  "lineuserid",
  "linechannelid",
  "channelid",
  "messageid",
  "ghlmessageid"
]);

const mimeTypeProbeKeys = new Set(["mime", "mimetype", "contenttype", "mediatype"]);
const filenameProbeKeys = new Set(["filename", "name", "originalname", "originalfilename"]);
const urlProbeKeys = new Set(["url", "uri", "href", "downloadurl", "fileurl", "mediaurl"]);

function getProbeRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeProbeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveProbeObjectKey(key: string): boolean {
  const normalizedKey = normalizeProbeKey(key);

  return (
    sensitiveProbeObjectKeys.has(normalizedKey) ||
    normalizedKey.endsWith("token") ||
    normalizedKey.endsWith("secret") ||
    normalizedKey.endsWith("password") ||
    normalizedKey.endsWith("signature")
  );
}

function getSafeProbeObjectKey(key: string, state: ProbeInspectionState): string | undefined {
  if (isSensitiveProbeObjectKey(key)) {
    return undefined;
  }

  if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) {
    return key;
  }

  state.placeholderIndex += 1;
  return `field_${state.placeholderIndex}`;
}

function stringLooksUrlLike(value: string): boolean {
  const inspectedValue = value.trim().slice(0, 2_048);
  return /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(inspectedValue);
}

function stringLooksMimeLike(value: string): boolean {
  const inspectedValue = value.trim().slice(0, 256);
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;.*)?$/i.test(inspectedValue);
}

function addProbeObjectKey(key: string, state: ProbeInspectionState): void {
  if (state.objectKeys.length >= probeMaxReturnedKeys) {
    return;
  }

  const safeKey = getSafeProbeObjectKey(key, state);
  if (!safeKey || state.objectKeySet.has(safeKey)) {
    return;
  }

  state.objectKeySet.add(safeKey);
  state.objectKeys.push(safeKey);
}

function inspectProbeValue(
  value: unknown,
  state: ProbeInspectionState,
  depth: number,
  parentKey?: string
): void {
  if (depth > probeMaxDepth || state.inspectedNodes >= probeMaxInspectedNodes) {
    return;
  }

  state.inspectedNodes += 1;
  const normalizedParentKey = parentKey ? normalizeProbeKey(parentKey) : undefined;

  if (typeof value === "string") {
    if (stringLooksUrlLike(value) || (normalizedParentKey && urlProbeKeys.has(normalizedParentKey) && value.trim())) {
      state.urlLikeValuePresent = true;
    }

    if (stringLooksMimeLike(value) || (normalizedParentKey && mimeTypeProbeKeys.has(normalizedParentKey))) {
      state.mimeTypePresent = true;
    }

    if (normalizedParentKey && filenameProbeKeys.has(normalizedParentKey)) {
      state.filenamePresent = true;
    }

    return;
  }

  if (typeof value !== "object" || value === null || state.seen.has(value)) {
    return;
  }

  state.seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value.slice(0, probeMaxArrayElements)) {
      inspectProbeValue(item, state, depth + 1);
      if (state.inspectedNodes >= probeMaxInspectedNodes) {
        break;
      }
    }
    return;
  }

  for (const key of Object.keys(value).slice(0, probeMaxObjectEntries)) {
    const normalizedKey = normalizeProbeKey(key);
    const childValue = (value as Record<string, unknown>)[key];

    addProbeObjectKey(key, state);

    if (mimeTypeProbeKeys.has(normalizedKey)) {
      state.mimeTypePresent = true;
    }

    if (filenameProbeKeys.has(normalizedKey)) {
      state.filenamePresent = true;
    }

    if (urlProbeKeys.has(normalizedKey) && typeof childValue === "string" && childValue.trim()) {
      state.urlLikeValuePresent = true;
    }

    inspectProbeValue(childValue, state, depth + 1, key);
    if (state.inspectedNodes >= probeMaxInspectedNodes) {
      break;
    }
  }
}

function getProbeActionField(
  payload: Record<string, unknown>,
  fieldName: (typeof probeFieldNames)[number]
): { present: boolean; value: unknown } {
  const data = getProbeRecord(payload.data);

  if (Object.prototype.hasOwnProperty.call(data, fieldName)) {
    return { present: true, value: data[fieldName] };
  }

  if (Object.prototype.hasOwnProperty.call(payload, fieldName)) {
    return { present: true, value: payload[fieldName] };
  }

  return { present: false, value: undefined };
}

function buildProbeFieldMetadata(payload: Record<string, unknown>, fieldName: (typeof probeFieldNames)[number]): ProbeFieldMetadata {
  const { present, value } = getProbeActionField(payload, fieldName);
  const state: ProbeInspectionState = {
    inspectedNodes: 0,
    placeholderIndex: 0,
    objectKeys: [],
    objectKeySet: new Set<string>(),
    urlLikeValuePresent: false,
    mimeTypePresent: false,
    filenamePresent: false,
    seen: new WeakSet<object>()
  };

  if (present) {
    inspectProbeValue(value, state, 0);
  }

  return {
    present,
    type: typeof value,
    isArray: Array.isArray(value),
    arrayLength: Array.isArray(value) ? value.length : null,
    objectKeys: state.objectKeys,
    urlLikeValuePresent: state.urlLikeValuePresent,
    mimeTypePresent: state.mimeTypePresent,
    filenamePresent: state.filenamePresent
  };
}

debugRouter.post("/debug/ghl/workflow-attachment-payload", (req, res) => {
  if (!isValidWorkflowActionSecret(req.header("x-wincrm-webhook-secret"))) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ ok: false, error: "Invalid workflow action payload" });
    return;
  }

  const payload = req.body as Record<string, unknown>;
  const fields = {
    message: buildProbeFieldMetadata(payload, "message"),
    imageAttachment: buildProbeFieldMetadata(payload, "imageAttachment"),
    videoAttachment: buildProbeFieldMetadata(payload, "videoAttachment")
  };

  logger.info(
    {
      probe: "ghl_workflow_attachment_payload",
      fields
    },
    "Inspected HighLevel workflow attachment payload structure"
  );

  res.json({ ok: true, fields });
});

const requireSharedSecretInProduction: RequestHandler = (req, res, next) => {
  if (env.NODE_ENV !== "production") {
    next();
    return;
  }

  requireSharedSecret(req, res, next);
};

debugRouter.use("/debug", requireSharedSecretInProduction);

debugRouter.get("/debug/env-check", (_req, res) => {
  res.json({
    ok: true,
    environment: getEnvPresenceReport()
  });
});

debugRouter.get("/debug/recent-events", async (_req, res, next) => {
  try {
    const events = redactSecrets(await getRecentDebugEvents());
    res.json({
      ok: true,
      ...events
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/oauth-status", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      oauth: await getConfiguredGhlOAuthStatus()
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/oauth-token-claims", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      claims: await getConfiguredGhlOAuthTokenClaims()
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/oauth-callback-config", (_req, res) => {
  res.json({
    ok: true,
    config: getOAuthCallbackConfig()
  });
});

debugRouter.get("/debug/provider-config", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      provider: await getGhlProviderConfigDebug()
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/inbound-send-auth-config", (_req, res) => {
  const inboundSendConfig = getGhlInboundSendAuthConfigDebug();
  const inboundSendPayloadConfig = getGhlInboundSendPayloadDebug();
  const effectiveInboundSendAuthMode = getEffectiveInboundSendAuthMode();
  const contactAuthMode = getConfiguredLocationApiAuthMode();

  res.json({
    ok: true,
    config: redactSecrets({
      ...inboundSendConfig,
      ...inboundSendPayloadConfig,
      effective_inbound_send_auth_mode: effectiveInboundSendAuthMode,
      contact_auth_mode: contactAuthMode,
      token_source_selected_for_inbound_send:
        effectiveInboundSendAuthMode === "private_integration" ? "private_integration_token" : "stored_oauth_access_token",
      GHL_LOCATION_API_AUTH_MODE: contactAuthMode
    })
  });
});

debugRouter.get("/debug/ghl-token-test", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await testGhlOAuthToken())
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/ghl-provider-test", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await testGhlConversationProviderAccess())
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/ghl-inbound-message-endpoint-test", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await testGhlInboundMessageEndpoint())
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/ghl-inbound-send-auth-test", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await testGhlInboundSendAuth())
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/ghl-contact-auth-test", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await testGhlContactAuth())
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/ghl-inbound-message-auth-matrix-test", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await testGhlInboundMessageAuthMatrix())
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/ghl-conversation-permission-test", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await testGhlConversationPermissions())
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/ghl-inbound-payload-matrix", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await testGhlInboundPayloadMatrix())
    });
  } catch (error) {
    next(error);
  }
});

debugRouter.get("/debug/ghl-token-install-summary", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      result: redactSecrets(await getGhlTokenInstallSummary())
    });
  } catch (error) {
    next(error);
  }
});
