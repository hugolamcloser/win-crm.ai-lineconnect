import { getSupabase } from "../config/supabase";

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
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  encryption_key_version: string | null;
  token_expires_at: string | null;
  granted_scopes: string[];
  created_at: string;
  updated_at: string;
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

export type Every8dGhlInstallationIdentity = {
  installationId: string;
  marketplaceAppId: string;
  oauthClientId: string;
  tenantId?: string;
  locationId?: string;
  conversationProviderId: string;
  installationGeneration?: number;
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
    eventAt: string;
    eventId: string;
  }): Promise<Every8dGhlMarketplaceInstallation>;
  getEligibleInstallation(input: Every8dGhlInstallationIdentity): Promise<Every8dGhlMarketplaceInstallation | null>;
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
  persistCredentials(input: {
    installationId: string;
    marketplaceAppId: string;
    oauthClientId: string;
    tenantId: string;
    locationId: string;
    companyId: string;
    conversationProviderId: string;
    installationGeneration: number;
    accessTokenCiphertext: string;
    refreshTokenCiphertext: string;
    encryptionKeyVersion: string;
    expiresAt: string;
    grantedScopes: string[];
  }): Promise<Every8dGhlMarketplaceInstallation | null>;
};

function throwDatabaseError(error: { message: string } | null): never {
  throw new Error(error?.message || "EVERY8D HighLevel OAuth persistence failed");
}

function encodeBytea(value: string): string {
  return `\\x${Buffer.from(value, "utf8").toString("hex")}`;
}

type Every8dGhlSupabaseGetter = () => ReturnType<typeof getSupabase>;

export function createEvery8dGhlOAuthRepository(
  getClient: Every8dGhlSupabaseGetter = getSupabase
): Every8dGhlOAuthRepository {
  return {
    async applyLifecycleEvent(input) {
      const { data, error } = await getClient()
        .rpc("apply_every8d_ghl_marketplace_lifecycle_v1", {
          input_event_type: input.eventType,
          input_marketplace_app_id: input.marketplaceAppId,
          input_oauth_client_id: input.oauthClientId,
          input_tenant_id: input.tenantId,
          input_location_id: input.locationId,
          input_company_id: input.companyId,
          input_conversation_provider_id: input.conversationProviderId,
          input_event_at: input.eventAt,
          input_event_id: input.eventId
        })
        .single();
      if (error || !data) throwDatabaseError(error);
      return data as Every8dGhlMarketplaceInstallation;
    },

    async getEligibleInstallation(input) {
      let query = getClient()
        .from("ghl_marketplace_installations")
        .select("*")
        .eq("id", input.installationId)
        .eq("app_namespace", "every8d_connect")
        .eq("marketplace_app_id", input.marketplaceAppId)
        .eq("oauth_client_id", input.oauthClientId)
        .eq("conversation_provider_id", input.conversationProviderId)
        .eq("channel", "sms")
        .eq("provider", "every8d")
        .in("status", ["pending", "active"]);

      if (input.tenantId) query = query.eq("tenant_id", input.tenantId);
      if (input.locationId) query = query.eq("location_id", input.locationId);
      if (input.installationGeneration) {
        query = query.eq("installation_generation", input.installationGeneration);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throwDatabaseError(error);
      return data as Every8dGhlMarketplaceInstallation | null;
    },

    async createOAuthState(input) {
      const { data, error } = await getClient()
        .from("ghl_marketplace_oauth_states")
        .insert({
          installation_id: input.installationId,
          installation_generation: input.installationGeneration,
          state_hash: input.stateHash,
          browser_binding_hash: input.browserBindingHash,
          redirect_uri: input.redirectUri,
          expires_at: input.expiresAt
        })
        .select("*")
        .single();
      if (error) throwDatabaseError(error);
      return data as Every8dGhlOAuthState;
    },

    async getOAuthStateByHash(stateHash) {
      const { data, error } = await getClient()
        .from("ghl_marketplace_oauth_states")
        .select("*")
        .eq("state_hash", stateHash)
        .maybeSingle();
      if (error) throwDatabaseError(error);
      return data as Every8dGhlOAuthState | null;
    },

    async consumeOAuthState(input) {
      const { data, error } = await getClient()
        .from("ghl_marketplace_oauth_states")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", input.stateId)
        .eq("state_hash", input.stateHash)
        .eq("installation_id", input.installationId)
        .eq("installation_generation", input.installationGeneration)
        .eq("browser_binding_hash", input.browserBindingHash)
        .eq("redirect_uri", input.redirectUri)
        .is("consumed_at", null)
        .is("revoked_at", null)
        .select("*")
        .maybeSingle();
      if (error) throwDatabaseError(error);
      return data as Every8dGhlOAuthState | null;
    },

    async persistCredentials(input) {
      const { data, error } = await getClient()
        .from("ghl_marketplace_installations")
        .update({
          access_token_ciphertext: encodeBytea(input.accessTokenCiphertext),
          refresh_token_ciphertext: encodeBytea(input.refreshTokenCiphertext),
          encryption_key_version: input.encryptionKeyVersion,
          token_expires_at: input.expiresAt,
          granted_scopes: input.grantedScopes
        })
        .eq("id", input.installationId)
        .eq("app_namespace", "every8d_connect")
        .eq("marketplace_app_id", input.marketplaceAppId)
        .eq("oauth_client_id", input.oauthClientId)
        .eq("tenant_id", input.tenantId)
        .eq("location_id", input.locationId)
        .eq("company_id", input.companyId)
        .eq("conversation_provider_id", input.conversationProviderId)
        .eq("installation_generation", input.installationGeneration)
        .in("status", ["pending", "active"])
        .select("*")
        .maybeSingle();
      if (error) throwDatabaseError(error);
      return data as Every8dGhlMarketplaceInstallation | null;
    }
  };
}

export const every8dGhlOAuthRepository = createEvery8dGhlOAuthRepository();

export type Every8dGhlExactTenant = {
  id: string;
  location_id: string;
  ghl_provider_id: string;
};

export async function getExactExistingTenantForEvery8d(
  locationId: string
): Promise<Every8dGhlExactTenant | null> {
  const { data, error } = await getSupabase()
    .from("tenants")
    .select("id,location_id,ghl_provider_id")
    .eq("location_id", locationId)
    .limit(2);

  if (error) throwDatabaseError(error);
  if (!data || data.length !== 1) return null;
  return data[0] as Every8dGhlExactTenant;
}
