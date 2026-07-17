import { Router, type RequestHandler } from "express";
import { env, getEnvPresenceReport } from "../config/env";
import { requireSharedSecret, requireWinCrmWebhookSecret } from "../middleware/sharedSecret";
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
import { runInternalCommentProbe } from "../services/ghlInternalCommentProbeService";
import { getRecentDebugEvents } from "../services/repository";
import { redactSecrets } from "../utils/redaction";

export const debugRouter = Router();

function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" ? String(value) : undefined;
}

// This temporary proof uses the Marketplace workflow header and must be registered
// before the existing production-only /debug middleware, which accepts other aliases.
debugRouter.post(
  "/debug/ghl/internal-comment-proof",
  requireWinCrmWebhookSecret,
  async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ error: "Invalid InternalComment probe payload" });
        return;
      }

      const result = await runInternalCommentProbe(
        req.body as Record<string, unknown>,
        normalizeRequestId(req.id)
      );
      res.status(result.httpStatus).json(result.body);
    } catch (error) {
      next(error);
    }
  }
);

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
