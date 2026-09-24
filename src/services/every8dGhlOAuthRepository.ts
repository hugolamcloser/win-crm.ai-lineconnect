import { getSupabase } from "../config/supabase";
import { z } from "zod";

export type Every8dLifecycleOutcome = "applied" | "exact_replay" | "stale_ignored";

export type Every8dGhlMarketplaceInstallation = {
  id: string;
  app_namespace: "every8d_connect";
  marketplace_app_id: string;
  oauth_client_id: string;
  tenant_id: string;
  location_id: string;
  company_id: string | null;
  conversation_provider_id: string;
  channel: "sms";
  provider: "every8d";
  status: "pending" | "active" | "disabled" | "uninstalled";
  installation_generation: number;
  latest_lifecycle_event_at: string | null;
  latest_lifecycle_event_id: string | null;
  latest_lifecycle_event_type: "INSTALL" | "UNINSTALL" | "INTERNAL_BASELINE" | null;
  latest_lifecycle_version_id: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  encryption_key_version: string | null;
  token_expires_at: string | null;
  granted_scopes: string[];
  created_at: string;
  updated_at: string;
};

export type Every8dOAuthBootstrapStatus =
  | "waiting_install" | "ready"
  | "exchanging" | "succeeded" | "failed";

export type Every8dOAuthBootstrap = {
  id: string;
  app_namespace: "every8d_connect";
  marketplace_version_id: string;
  expected_location_id: string;
  target_installation_generation: number;
  state_hash: string;
  browser_binding_hash?: string;
  redirect_uri: string;
  config_fingerprint: string;
  status: Every8dOAuthBootstrapStatus;
  created_at?: string;
  expires_at: string;
  callback_received_at?: string | null;
  authorization_code_ciphertext?: string | null;
  authorization_code_key_version?: string | null;
  claimed_installation_id?: string | null;
  claimed_installation_generation?: number | null;
  exchange_started_at?: string | null;
  terminal_at?: string | null;
  failure_class?: string | null;
};

export type Every8dOAuthExchangeClaim = {
  bootstrap: Every8dOAuthBootstrap;
  installation: Every8dGhlMarketplaceInstallation;
};

export type Every8dGhlOAuthState = {
  id: string;
  installation_id: string;
  installation_generation: number;
  state_hash: string;
  browser_binding_hash: string;
  redirect_uri: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

export type Every8dGhlOAuthRepository = {
  applyLifecycleEvent(input: {
    eventType: "INSTALL" | "UNINSTALL";
    marketplaceAppId: string;
    oauthClientId: string;
    tenantId: string | null;
    locationId: string;
    companyId: string | null;
    conversationProviderId: string;
    marketplaceVersionId: string;
    eventAt: string;
    eventId: string;
  }): Promise<{ outcome: Every8dLifecycleOutcome; installation: Every8dGhlMarketplaceInstallation }>;
  acceptCallback(input: {
    marketplaceAppId: string;
    oauthClientId: string;
    conversationProviderId: string;
    marketplaceVersionId: string;
    expectedLocationId: string;
    stateHash: string;
    browserBindingHash: string;
    redirectUri: string;
    configFingerprint: string;
    expiresAt: string;
    authorizationCodeCiphertext: string;
    authorizationCodeKeyVersion: string;
  }): Promise<{ id: string; status: "waiting_install" | "ready"; targetInstallationGeneration: number; expiresAt: string } | null>;
  listRecoverable(input: { marketplaceVersionId: string; configFingerprint: string; limit: number }): Promise<string[]>;
  claimExchange(input: { bootstrapId: string; marketplaceVersionId: string; configFingerprint: string }): Promise<Every8dOAuthExchangeClaim | null>;
  failBootstrap(input: { bootstrapId: string; failureClass: string }): Promise<boolean>;
  finalizeExchange(input: {
    bootstrapId: string;
    marketplaceVersionId: string;
    configFingerprint: string;
    accessTokenCiphertext: string;
    refreshTokenCiphertext: string;
    encryptionKeyVersion: string;
    tokenExpiresAt: string;
    grantedScopes: string[];
  }): Promise<boolean>;
  getStatus(input: { browserBindingHash: string; configFingerprint: string }): Promise<Every8dOAuthBootstrapStatus | null>;
  getEligibleInstallation(input: {
    installationId: string;
    marketplaceAppId: string;
    oauthClientId: string;
    tenantId?: string;
    locationId?: string;
    conversationProviderId: string;
    installationGeneration?: number;
    marketplaceVersionId: string;
  }): Promise<Every8dGhlMarketplaceInstallation | null>;
  createOAuthState(input: {
    installationId: string;
    installationGeneration: number;
    stateHash: string;
    browserBindingHash: string;
    redirectUri: string;
    expiresAt: string;
  }): Promise<Every8dGhlOAuthState>;
  getOAuthStateByHash(stateHash: string): Promise<Every8dGhlOAuthState | null>;
  consumeOAuthState(input: {
    stateId: string;
    stateHash: string;
    installationId: string;
    installationGeneration: number;
    browserBindingHash: string;
    redirectUri: string;
  }): Promise<Every8dGhlOAuthState | null>;
  persistInstalledCredentials(input: {
    installationId: string;
    marketplaceAppId: string;
    oauthClientId: string;
    tenantId: string;
    locationId: string;
    companyId: string;
    conversationProviderId: string;
    installationGeneration: number;
    marketplaceVersionId: string;
    accessTokenCiphertext: string;
    refreshTokenCiphertext: string;
    encryptionKeyVersion: string;
    expiresAt: string;
    grantedScopes: string[];
  }): Promise<Every8dGhlMarketplaceInstallation | null>;
};

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const identifierSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,256}$/);
const byteaSchema = z.string().regex(/^\\x[0-9a-f]+$/i);
const lifecycleOutcomeSchema = z.enum(["applied", "exact_replay", "stale_ignored"]);
const bootstrapStatusSchema = z.enum(["waiting_install", "ready", "exchanging", "succeeded", "failed"]);
const installationSchema = z.object({
  id: uuidSchema,
  app_namespace: z.literal("every8d_connect"),
  marketplace_app_id: z.string().min(1),
  oauth_client_id: z.string().min(1),
  tenant_id: uuidSchema,
  location_id: z.string().min(1),
  company_id: z.string().min(1).nullable(),
  conversation_provider_id: z.string().min(1),
  channel: z.literal("sms"),
  provider: z.literal("every8d"),
  status: z.enum(["pending", "active", "disabled", "uninstalled"]),
  installation_generation: z.number().int().positive(),
  latest_lifecycle_event_at: timestampSchema.nullable(),
  latest_lifecycle_event_id: z.string().min(1).nullable(),
  latest_lifecycle_event_type: z.enum(["INSTALL", "UNINSTALL", "INTERNAL_BASELINE"]).nullable(),
  latest_lifecycle_version_id: z.string().min(1).nullable(),
  access_token_ciphertext: byteaSchema.nullable(),
  refresh_token_ciphertext: byteaSchema.nullable(),
  encryption_key_version: z.string().nullable(),
  token_expires_at: timestampSchema.nullable(),
  granted_scopes: z.array(z.string().min(1).refine((scope) => scope === scope.trim())),
  created_at: timestampSchema,
  updated_at: timestampSchema
}).strict();
const bootstrapSchema = z.object({
  id: uuidSchema,
  app_namespace: z.literal("every8d_connect"),
  marketplace_version_id: identifierSchema,
  expected_location_id: identifierSchema,
  target_installation_generation: z.number().int().positive(),
  state_hash: hashSchema,
  browser_binding_hash: hashSchema,
  redirect_uri: z.string().url(),
  config_fingerprint: hashSchema,
  status: bootstrapStatusSchema,
  created_at: timestampSchema,
  expires_at: timestampSchema,
  callback_received_at: timestampSchema,
  authorization_code_ciphertext: z.string().nullable(),
  authorization_code_key_version: identifierSchema.nullable(),
  claimed_installation_id: uuidSchema.nullable(),
  claimed_installation_generation: z.number().int().positive().nullable(),
  exchange_started_at: timestampSchema.nullable(),
  terminal_at: timestampSchema.nullable(),
  failure_class: z.string().min(1).nullable()
}).strict();
const lifecycleResultSchema = z.object({
  outcome: lifecycleOutcomeSchema,
  installation: installationSchema
}).strict();
const callbackAcceptanceSchema = z.object({
  id: uuidSchema,
  status: z.enum(["waiting_install", "ready"]),
  targetInstallationGeneration: z.number().int().positive(),
  expiresAt: timestampSchema
}).strict().nullable();
const exchangeClaimSchema = z.object({
  bootstrap: bootstrapSchema,
  installation: installationSchema
}).strict().nullable();
const recoverableSchema = z.array(z.union([
  uuidSchema,
  z.object({ list_every8d_oauth_recoverable_v1: uuidSchema }).strict()
]));

function parseRpc<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throwDatabaseError(null);
  return parsed.data;
}

function throwDatabaseError(error: { message: string } | null): never {
  throw new Error(error?.message || "EVERY8D HighLevel OAuth persistence failed");
}

function encodeBytea(value: string): string {
  return `\\x${Buffer.from(value, "utf8").toString("hex")}`;
}

function decodeBytea(value: unknown): string {
  if (typeof value !== "string" || !/^\\x[0-9a-f]+$/i.test(value)) {
    throw new Error("EVERY8D HighLevel OAuth persistence returned invalid ciphertext");
  }
  return Buffer.from(value.slice(2), "hex").toString("utf8");
}

type Every8dGhlSupabaseGetter = () => ReturnType<typeof getSupabase>;

export function createEvery8dGhlOAuthRepository(
  getClient: Every8dGhlSupabaseGetter = getSupabase
): Every8dGhlOAuthRepository {
  async function rpcScalar(name: string, input: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await getClient().rpc(name, input);
    if (error) throwDatabaseError(error);
    return data;
  }

  return {
    async applyLifecycleEvent(input) {
      const data = await rpcScalar("apply_every8d_ghl_marketplace_lifecycle_v2", {
        input_event_type: input.eventType,
        input_marketplace_app_id: input.marketplaceAppId,
        input_oauth_client_id: input.oauthClientId,
        input_tenant_id: input.tenantId,
        input_location_id: input.locationId,
        input_company_id: input.companyId,
        input_conversation_provider_id: input.conversationProviderId,
        input_marketplace_version_id: input.marketplaceVersionId,
        input_event_at: input.eventAt,
        input_event_id: input.eventId
      });
      return parseRpc(lifecycleResultSchema, data);
    },

    async acceptCallback(input) {
      const data = await rpcScalar("accept_every8d_public_oauth_callback_v1", {
        input_marketplace_app_id: input.marketplaceAppId,
        input_oauth_client_id: input.oauthClientId,
        input_conversation_provider_id: input.conversationProviderId,
        input_marketplace_version_id: input.marketplaceVersionId,
        input_expected_location_id: input.expectedLocationId,
        input_state_hash: input.stateHash,
        input_browser_binding_hash: input.browserBindingHash,
        input_redirect_uri: input.redirectUri,
        input_config_fingerprint: input.configFingerprint,
        input_expires_at: input.expiresAt,
        input_authorization_code_ciphertext: encodeBytea(input.authorizationCodeCiphertext),
        input_authorization_code_key_version: input.authorizationCodeKeyVersion
      });
      return parseRpc(callbackAcceptanceSchema, data);
    },

    async listRecoverable(input) {
      const data = await rpcScalar("list_every8d_oauth_recoverable_v1", {
        input_marketplace_version_id: input.marketplaceVersionId,
        input_config_fingerprint: input.configFingerprint,
        input_limit: input.limit
      });
      return parseRpc(recoverableSchema, data).map((entry) => typeof entry === "string"
        ? entry : entry.list_every8d_oauth_recoverable_v1);
    },

    async claimExchange(input) {
      const data = await rpcScalar("claim_every8d_oauth_exchange_v1", {
        input_bootstrap_id: input.bootstrapId,
        input_marketplace_version_id: input.marketplaceVersionId,
        input_config_fingerprint: input.configFingerprint
      });
      const claim = parseRpc(exchangeClaimSchema, data);
      if (!claim) return null;
      if (claim.bootstrap.authorization_code_ciphertext) {
        claim.bootstrap.authorization_code_ciphertext = decodeBytea(claim.bootstrap.authorization_code_ciphertext);
      }
      return claim;
    },

    async failBootstrap(input) {
      return parseRpc(z.boolean(), await rpcScalar("fail_every8d_oauth_bootstrap_v1", {
        input_bootstrap_id: input.bootstrapId,
        input_failure_class: input.failureClass
      }));
    },

    async finalizeExchange(input) {
      return parseRpc(z.boolean(), await rpcScalar("finalize_every8d_oauth_exchange_v1", {
        input_bootstrap_id: input.bootstrapId,
        input_marketplace_version_id: input.marketplaceVersionId,
        input_config_fingerprint: input.configFingerprint,
        input_access_token_ciphertext: encodeBytea(input.accessTokenCiphertext),
        input_refresh_token_ciphertext: encodeBytea(input.refreshTokenCiphertext),
        input_encryption_key_version: input.encryptionKeyVersion,
        input_token_expires_at: input.tokenExpiresAt,
        input_granted_scopes: input.grantedScopes
      }));
    },

    async getStatus(input) {
      const data = await rpcScalar("get_every8d_oauth_bootstrap_status_v1", {
        input_browser_binding_hash: input.browserBindingHash,
        input_config_fingerprint: input.configFingerprint
      });
      return parseRpc(bootstrapStatusSchema.nullable(), data);
    },

    async getEligibleInstallation(input) {
      let query = getClient().from("ghl_marketplace_installations").select("*")
        .eq("id", input.installationId)
        .eq("app_namespace", "every8d_connect")
        .eq("marketplace_app_id", input.marketplaceAppId)
        .eq("oauth_client_id", input.oauthClientId)
        .eq("conversation_provider_id", input.conversationProviderId)
        .eq("channel", "sms").eq("provider", "every8d")
        .eq("latest_lifecycle_event_type", "INSTALL")
        .eq("latest_lifecycle_version_id", input.marketplaceVersionId)
        .in("status", ["pending", "active"]);
      if (input.tenantId) query = query.eq("tenant_id", input.tenantId);
      if (input.locationId) query = query.eq("location_id", input.locationId);
      if (input.installationGeneration) query = query.eq("installation_generation", input.installationGeneration);
      const { data, error } = await query.maybeSingle();
      if (error) throwDatabaseError(error);
      return data as Every8dGhlMarketplaceInstallation | null;
    },

    async createOAuthState(input) {
      const { data, error } = await getClient().from("ghl_marketplace_oauth_states").insert({
        installation_id: input.installationId,
        installation_generation: input.installationGeneration,
        state_hash: input.stateHash,
        browser_binding_hash: input.browserBindingHash,
        redirect_uri: input.redirectUri,
        expires_at: input.expiresAt
      }).select("*").single();
      if (error || !data) throwDatabaseError(error);
      return data as Every8dGhlOAuthState;
    },

    async getOAuthStateByHash(stateHash) {
      const { data, error } = await getClient().from("ghl_marketplace_oauth_states")
        .select("*").eq("state_hash", stateHash).maybeSingle();
      if (error) throwDatabaseError(error);
      return data as Every8dGhlOAuthState | null;
    },

    async consumeOAuthState(input) {
      const { data, error } = await getClient().from("ghl_marketplace_oauth_states")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", input.stateId).eq("state_hash", input.stateHash)
        .eq("installation_id", input.installationId)
        .eq("installation_generation", input.installationGeneration)
        .eq("browser_binding_hash", input.browserBindingHash)
        .eq("redirect_uri", input.redirectUri)
        .is("consumed_at", null).is("revoked_at", null)
        .select("*").maybeSingle();
      if (error) throwDatabaseError(error);
      return data as Every8dGhlOAuthState | null;
    },

    async persistInstalledCredentials(input) {
      const { data, error } = await getClient().from("ghl_marketplace_installations").update({
        access_token_ciphertext: encodeBytea(input.accessTokenCiphertext),
        refresh_token_ciphertext: encodeBytea(input.refreshTokenCiphertext),
        encryption_key_version: input.encryptionKeyVersion,
        token_expires_at: input.expiresAt,
        granted_scopes: input.grantedScopes
      }).eq("id", input.installationId)
        .eq("app_namespace", "every8d_connect")
        .eq("marketplace_app_id", input.marketplaceAppId)
        .eq("oauth_client_id", input.oauthClientId)
        .eq("tenant_id", input.tenantId).eq("location_id", input.locationId)
        .eq("company_id", input.companyId)
        .eq("conversation_provider_id", input.conversationProviderId)
        .eq("installation_generation", input.installationGeneration)
        .eq("latest_lifecycle_event_type", "INSTALL")
        .eq("latest_lifecycle_version_id", input.marketplaceVersionId)
        .in("status", ["pending", "active"]).select("*").maybeSingle();
      if (error) throwDatabaseError(error);
      return parseRpc(installationSchema.nullable(), data);
    }
  };
}

export const every8dGhlOAuthRepository = createEvery8dGhlOAuthRepository();

export type Every8dGhlExactTenant = { id: string; location_id: string; ghl_provider_id: string };

export async function getExactExistingTenantForEvery8d(locationId: string): Promise<Every8dGhlExactTenant | null> {
  const { data, error } = await getSupabase().from("tenants")
    .select("id,location_id,ghl_provider_id").eq("location_id", locationId).limit(2);
  if (error) throwDatabaseError(error);
  if (!data || data.length !== 1) return null;
  return data[0] as Every8dGhlExactTenant;
}
