import { env, requireEnvValue } from "../config/env";
import { getSupabase } from "../config/supabase";

export type LineProfileRecord = {
  id: string;
  tenant_id: string;
  line_user_id: string;
  line_source_type: string;
  line_source_id: string;
  display_name: string | null;
  picture_url: string | null;
  ghl_contact_id: string | null;
  ghl_conversation_id: string | null;
};

export type UpsertLineProfileInput = {
  tenantId: string;
  lineUserId: string;
  lineSourceType: string;
  lineSourceId: string;
  displayName?: string;
  pictureUrl?: string;
};

export type SaveMessageEventInput = {
  tenantId: string;
  provider: "line" | "ghl";
  direction: "inbound" | "outbound";
  externalMessageId?: string;
  lineUserId?: string;
  ghlMessageId?: string;
  ghlConversationId?: string;
  payload: unknown;
  status: "received" | "sent" | "skipped" | "failed";
  errorMessage?: string;
};

function requireSingle<T>(data: T | null, error: { message: string } | null): T {
  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Supabase returned no data");
  }

  return data;
}

export async function ensureDefaultTenant(): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tenants")
    .upsert(
      {
        location_id: requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID),
        ghl_provider_id: requireEnvValue("GHL_CUSTOM_PROVIDER_ID", env.GHL_CUSTOM_PROVIDER_ID),
        line_channel_id: "default"
      },
      { onConflict: "location_id,ghl_provider_id,line_channel_id" }
    )
    .select("id")
    .single();

  return requireSingle<{ id: string }>(data, error).id;
}

export async function upsertLineProfile(input: UpsertLineProfileInput): Promise<LineProfileRecord> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("line_profiles")
    .upsert(
      {
        tenant_id: input.tenantId,
        line_user_id: input.lineUserId,
        line_source_type: input.lineSourceType,
        line_source_id: input.lineSourceId,
        display_name: input.displayName ?? null,
        picture_url: input.pictureUrl ?? null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "tenant_id,line_source_id,line_user_id" }
    )
    .select("*")
    .single();

  return requireSingle<LineProfileRecord>(data, error);
}

export async function findLineProfileByLineUser(tenantId: string, lineUserId: string): Promise<LineProfileRecord | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("line_profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as LineProfileRecord | null;
}

export async function findLineProfileByGhlIds(
  tenantId: string,
  ids: { contactId?: string; conversationId?: string }
): Promise<LineProfileRecord | null> {
  const supabase = getSupabase();
  let query = supabase.from("line_profiles").select("*").eq("tenant_id", tenantId);

  if (ids.conversationId) {
    query = query.eq("ghl_conversation_id", ids.conversationId);
  } else if (ids.contactId) {
    query = query.eq("ghl_contact_id", ids.contactId);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as LineProfileRecord | null;
}

export async function linkGhlMapping(input: {
  tenantId: string;
  lineUserId: string;
  ghlContactId?: string;
  ghlConversationId?: string;
}): Promise<LineProfileRecord> {
  const supabase = getSupabase();
  const patch: Record<string, string | null> = {
    updated_at: new Date().toISOString()
  };

  if (input.ghlContactId) {
    patch.ghl_contact_id = input.ghlContactId;
  }

  if (input.ghlConversationId) {
    patch.ghl_conversation_id = input.ghlConversationId;
  }

  const { data, error } = await supabase
    .from("line_profiles")
    .update(patch)
    .eq("tenant_id", input.tenantId)
    .eq("line_user_id", input.lineUserId)
    .select("*")
    .single();

  return requireSingle<LineProfileRecord>(data, error);
}

export async function saveMessageEvent(input: SaveMessageEventInput): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("message_events").insert({
    tenant_id: input.tenantId,
    provider: input.provider,
    direction: input.direction,
    external_message_id: input.externalMessageId ?? null,
    line_user_id: input.lineUserId ?? null,
    ghl_message_id: input.ghlMessageId ?? null,
    ghl_conversation_id: input.ghlConversationId ?? null,
    payload: input.payload,
    status: input.status,
    error_message: input.errorMessage ?? null
  });

  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }
}
