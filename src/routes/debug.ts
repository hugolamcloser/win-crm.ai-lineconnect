import { Router } from "express";
import { getEnvPresenceReport } from "../config/env";
import {
  getGhlInboundSendAuthConfigDebug,
  getGhlProviderConfigDebug,
  testGhlInboundMessageEndpoint,
  testGhlConversationProviderAccess,
  testGhlOAuthToken
} from "../integrations/ghlClient";
import { testGhlInboundMessageAuthMatrix } from "../integrations/ghlInboundAuthMatrix";
import { testConfiguredGhlInboundSendAuth } from "../integrations/ghlInboundMessageClient";
import {
  getConfiguredLocationApiAuthMode,
  getEffectiveInboundSendAuthMode,
  testGhlContactAuth
} from "../integrations/ghlLocationClient";
import {
  getConfiguredGhlOAuthStatus,
  getConfiguredGhlOAuthTokenClaims,
  getOAuthCallbackConfig
} from "../services/ghlOAuthService";
import { getRecentDebugEvents } from "../services/repository";
import { redactSecrets } from "../utils/redaction";

export const debugRouter = Router();

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
  const effectiveInboundSendAuthMode = getEffectiveInboundSendAuthMode();
  const contactAuthMode = getConfiguredLocationApiAuthMode();

  res.json({
    ok: true,
    config: redactSecrets({
      ...inboundSendConfig,
      configured_inbound_send_auth_mode: inboundSendConfig.GHL_INBOUND_SEND_AUTH_MODE,
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
      result: redactSecrets(await testConfiguredGhlInboundSendAuth())
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
