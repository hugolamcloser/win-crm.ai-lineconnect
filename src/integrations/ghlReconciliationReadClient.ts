import { env, requireEnvValue } from "../config/env";
import { getGhlOAuthToken, type GhlOAuthTokenRecord } from "../services/repository";
import type {
  GhlReconciliationContact,
  GhlReconciliationCustomFieldDefinition,
  ReconciliationReadStatus,
  ReconciliationRiskKey
} from "../types/lineContactReconciliation";

const DEFAULT_READ_TIMEOUT_MS = 2_500;
const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 30_000;
const transferableStandardFieldNames = [
  "firstName",
  "lastName",
  "name",
  "email",
  "phone",
  "address1",
  "city",
  "state",
  "country",
  "postalCode",
  "website",
  "companyName",
  "dateOfBirth",
  "source",
  "assignedTo"
] as const;

const riskScopes: Record<ReconciliationRiskKey, string> = {
  conversations: "conversations.readonly",
  notes: "contacts.readonly",
  tasks: "contacts.readonly",
  opportunities: "opportunities.readonly",
  appointments: "contacts.readonly",
  orders: "payments/orders.readonly",
  transactions: "payments/transactions.readonly",
  invoices: "invoices.readonly"
};

export const reconciliationRequiredReadScopes = [
  "contacts.readonly",
  "locations/customFields.readonly",
  ...new Set(Object.values(riskScopes))
] as const;

const allowedGetPathPatterns = [
  /^\/contacts\/[^/]+$/,
  /^\/locations\/[^/]+\/customFields$/,
  /^\/contacts\/[^/]+\/(notes|tasks|appointments)$/,
  /^\/conversations\/search$/,
  /^\/opportunities\/search$/,
  /^\/payments\/(orders|transactions)$/,
  /^\/invoices\/$/
] as const;

export type GhlReconciliationReadErrorKind =
  | "MISSING_SCOPE"
  | "UNAVAILABLE"
  | "MALFORMED"
  | "NOT_FOUND"
  | "CROSS_TENANT";

export class GhlReconciliationReadError extends Error {
  public readonly kind: GhlReconciliationReadErrorKind;
  public readonly statusCode?: number;

  constructor(kind: GhlReconciliationReadErrorKind, message: string, statusCode?: number) {
    super(message);
    this.name = "GhlReconciliationReadError";
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

export function assertReconciliationTransportAllowed(method: string, path: string): void {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = path.split("?", 1)[0] ?? path;
  const allowed =
    (normalizedMethod === "GET" && allowedGetPathPatterns.some((pattern) => pattern.test(normalizedPath))) ||
    (normalizedMethod === "POST" && normalizedPath === "/contacts/search");

  if (!allowed) {
    throw new Error(`Rejected non-read reconciliation transport: ${normalizedMethod}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getArray(payload: unknown, keys: readonly string[]): unknown[] | undefined {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  const nestedData = payload.data;

  if (isRecord(nestedData)) {
    for (const key of keys) {
      if (Array.isArray(nestedData[key])) {
        return nestedData[key];
      }
    }
  }

  return undefined;
}

function getNonNegativeCount(payload: unknown): number | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const containers = [payload, isRecord(payload.meta) ? payload.meta : undefined, isRecord(payload.data) ? payload.data : undefined];

  for (const container of containers) {
    if (!container) {
      continue;
    }

    for (const key of ["total", "totalCount", "count"]) {
      const value = container[key];

      if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        return value;
      }
    }
  }

  return undefined;
}

function parseContact(payload: unknown): GhlReconciliationContact {
  const root = isRecord(payload) ? payload : undefined;
  const contact = root && isRecord(root.contact) ? root.contact : root;
  const id = getString(contact?.id) ?? getString(contact?.contactId);

  if (!contact || !id) {
    throw new GhlReconciliationReadError("MALFORMED", "HighLevel contact response was malformed");
  }

  const rawTags = Array.isArray(contact.tags) ? contact.tags : [];

  if (contact.customFields !== undefined && !Array.isArray(contact.customFields)) {
    throw new GhlReconciliationReadError("MALFORMED", "HighLevel contact custom fields were malformed");
  }

  const rawCustomFields = Array.isArray(contact.customFields) ? contact.customFields : [];
  const customFields = rawCustomFields.map((entry) => {
    if (!isRecord(entry)) {
      throw new GhlReconciliationReadError("MALFORMED", "HighLevel contact custom-field entry was malformed");
    }

    const fieldId = getString(entry.id) ?? getString(entry.fieldId);

    if (!fieldId) {
      throw new GhlReconciliationReadError("MALFORMED", "HighLevel contact custom-field entry had no field ID");
    }

    return { id: fieldId, value: entry.value };
  });
  const standardFields = Object.fromEntries(
    transferableStandardFieldNames
      .filter((fieldName) => contact[fieldName] !== undefined && contact[fieldName] !== null)
      .map((fieldName) => [fieldName, contact[fieldName]])
  );

  return {
    id,
    locationId: getString(contact.locationId) ?? getString(contact.location_id),
    email: getString(contact.email),
    phone: getString(contact.phone),
    tags: rawTags.map(getString).filter((tag): tag is string => Boolean(tag)),
    customFields,
    standardFields
  };
}

function parseContactList(payload: unknown): GhlReconciliationContact[] {
  const entries = getArray(payload, ["contacts"]);

  if (!entries) {
    throw new GhlReconciliationReadError("MALFORMED", "HighLevel contact search response was malformed");
  }

  const total = getNonNegativeCount(payload);

  if ((total !== undefined && total > entries.length) || (total === undefined && entries.length >= 100)) {
    throw new GhlReconciliationReadError("MALFORMED", "HighLevel contact search pagination was incomplete");
  }

  return entries.map(parseContact);
}

function parseCustomFieldDefinitions(payload: unknown): GhlReconciliationCustomFieldDefinition[] {
  const entries = getArray(payload, ["customFields", "fields"]);

  if (!entries) {
    throw new GhlReconciliationReadError("MALFORMED", "HighLevel custom-field response was malformed");
  }

  const definitions = entries.map((entry) => {
    if (!isRecord(entry) || !getString(entry.id)) {
      throw new GhlReconciliationReadError("MALFORMED", "HighLevel custom-field definition was malformed");
    }

    return {
      id: getString(entry.id) as string,
      name: getString(entry.name),
      fieldKey: getString(entry.fieldKey),
      model: getString(entry.model)
    };
  });
  const definitionIds = definitions.map((definition) => definition.id);

  if (new Set(definitionIds).size !== definitionIds.length) {
    throw new GhlReconciliationReadError("MALFORMED", "HighLevel custom-field definitions contained duplicate IDs");
  }

  return definitions;
}

function riskArrayKeys(risk: ReconciliationRiskKey): string[] {
  switch (risk) {
    case "appointments":
      return ["appointments", "events"];
    case "orders":
      return ["orders", "data"];
    case "transactions":
      return ["transactions", "data"];
    case "invoices":
      return ["invoices", "data"];
    default:
      return [risk];
  }
}

function buildRiskRequest(
  risk: ReconciliationRiskKey,
  locationId: string,
  contactId: string
): { path: string; query?: URLSearchParams } {
  const location = locationId;
  const contact = contactId;

  switch (risk) {
    case "conversations":
      return { path: "/conversations/search", query: new URLSearchParams({ locationId: location, contactId: contact, limit: "1" }) };
    case "notes":
    case "tasks":
    case "appointments":
      return { path: `/contacts/${encodeURIComponent(contact)}/${risk}` };
    case "opportunities":
      return { path: "/opportunities/search", query: new URLSearchParams({ location_id: location, contact_id: contact, limit: "1" }) };
    case "orders":
      return { path: "/payments/orders", query: new URLSearchParams({ altId: location, contactId: contact, limit: "1", offset: "0" }) };
    case "transactions":
      return { path: "/payments/transactions", query: new URLSearchParams({ altId: location, altType: "location", contactId: contact, limit: "1", offset: "0" }) };
    case "invoices":
      return { path: "/invoices/", query: new URLSearchParams({ altId: location, altType: "location", contactId: contact, limit: "1", offset: "0" }) };
  }
}

type ReadSession = {
  getContact(contactId: string, overallDeadlineAt: number): Promise<GhlReconciliationContact>;
  searchContacts(
    field: "email" | "phone",
    value: string,
    overallDeadlineAt: number
  ): Promise<GhlReconciliationContact[]>;
  getCustomFieldDefinitions(overallDeadlineAt: number): Promise<GhlReconciliationCustomFieldDefinition[]>;
  checkAssociatedRecords(
    risk: ReconciliationRiskKey,
    contactId: string,
    overallDeadlineAt: number
  ): Promise<ReconciliationReadStatus>;
  missingRequiredScopes: string[];
};

export type GhlReconciliationReadClient = {
  openSession(locationId: string, tenantId: string, overallDeadlineAt: number): Promise<ReadSession>;
};

type ReadClientDependencies = {
  loadToken: (locationId: string) => Promise<GhlOAuthTokenRecord | null>;
  fetchImpl: typeof fetch;
  now: () => number;
  perReadTimeoutMs: number;
};

export function createGhlReconciliationReadClient(
  overrides: Partial<ReadClientDependencies> = {}
): GhlReconciliationReadClient {
  const dependencies: ReadClientDependencies = {
    loadToken: getGhlOAuthToken,
    fetchImpl: fetch,
    now: Date.now,
    perReadTimeoutMs: DEFAULT_READ_TIMEOUT_MS,
    ...overrides
  };

  return {
    async openSession(locationId, tenantId, overallDeadlineAt) {
      const token = await dependencies.loadToken(locationId);

      if (!token) {
        throw new GhlReconciliationReadError("UNAVAILABLE", "No stored location OAuth token is available");
      }

      if (token.location_id !== locationId || token.tenant_id !== tenantId) {
        throw new GhlReconciliationReadError("CROSS_TENANT", "Stored OAuth context did not match the resolved tenant and location");
      }

      const expiry = new Date(token.expires_at).getTime();

      if (!Number.isFinite(expiry) || expiry <= dependencies.now() + TOKEN_EXPIRY_SAFETY_WINDOW_MS) {
        throw new GhlReconciliationReadError("UNAVAILABLE", "Stored OAuth token is expired or too close to expiry for a read-only preview");
      }

      const scopes = new Set((token.scopes ?? []).map((scope) => scope.trim()).filter(Boolean));
      const missingRequiredScopes = reconciliationRequiredReadScopes.filter((scope) => !scopes.has(scope));

      const request = async (input: {
        method: "GET" | "POST";
        path: string;
        query?: URLSearchParams;
        body?: unknown;
        requiredScope: string;
        overallDeadlineAt: number;
      }): Promise<unknown> => {
        assertReconciliationTransportAllowed(input.method, input.path);

        if (!scopes.has(input.requiredScope)) {
          throw new GhlReconciliationReadError("MISSING_SCOPE", "Required HighLevel read scope is not present");
        }

        const remainingMs = input.overallDeadlineAt - dependencies.now();

        if (remainingMs <= 0) {
          throw new GhlReconciliationReadError("UNAVAILABLE", "Preview deadline was reached before the HighLevel read");
        }

        const timeoutMs = Math.max(1, Math.min(dependencies.perReadTimeoutMs, remainingMs));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const url = new URL(input.path, env.GHL_API_BASE_URL);
          input.query?.forEach((value, key) => url.searchParams.append(key, value));
          const response = await dependencies.fetchImpl(url, {
            method: input.method,
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Version: requireEnvValue("GHL_API_VERSION", env.GHL_API_VERSION),
              Accept: "application/json",
              ...(input.body === undefined ? {} : { "Content-Type": "application/json" })
            },
            body: input.body === undefined ? undefined : JSON.stringify(input.body)
          });

          if (response.status === 403) {
            throw new GhlReconciliationReadError("MISSING_SCOPE", "HighLevel denied a required read scope", response.status);
          }

          if (response.status === 404 && input.method === "GET" && /^\/contacts\/[^/]+$/.test(input.path)) {
            throw new GhlReconciliationReadError("NOT_FOUND", "HighLevel contact was not found", response.status);
          }

          if (!response.ok) {
            throw new GhlReconciliationReadError("UNAVAILABLE", "HighLevel read request was unavailable", response.status);
          }

          const text = await response.text();

          try {
            return text ? JSON.parse(text) : {};
          } catch {
            throw new GhlReconciliationReadError("MALFORMED", "HighLevel read response was not valid JSON");
          }
        } catch (error) {
          if (error instanceof GhlReconciliationReadError) {
            throw error;
          }

          throw new GhlReconciliationReadError("UNAVAILABLE", "HighLevel read request timed out or failed");
        } finally {
          clearTimeout(timeout);
        }
      };

      return {
        missingRequiredScopes,
        async getContact(contactId, deadlineAt) {
          return parseContact(await request({
            method: "GET",
            path: `/contacts/${encodeURIComponent(contactId)}`,
            requiredScope: "contacts.readonly",
            overallDeadlineAt: deadlineAt
          }));
        },
        async searchContacts(field, value, deadlineAt) {
          return parseContactList(await request({
            method: "POST",
            path: "/contacts/search",
            requiredScope: "contacts.readonly",
            overallDeadlineAt: deadlineAt,
            body: {
              locationId,
              page: 1,
              pageLimit: 100,
              filters: [{ field, operator: "eq", value }]
            }
          }));
        },
        async getCustomFieldDefinitions(deadlineAt) {
          return parseCustomFieldDefinitions(await request({
            method: "GET",
            path: `/locations/${encodeURIComponent(locationId)}/customFields`,
            query: new URLSearchParams({ model: "contact" }),
            requiredScope: "locations/customFields.readonly",
            overallDeadlineAt: deadlineAt
          }));
        },
        async checkAssociatedRecords(risk, contactId, deadlineAt) {
          if (!scopes.has(riskScopes[risk])) {
            return "MISSING_SCOPE";
          }

          const riskRequest = buildRiskRequest(risk, locationId, contactId);

          try {
            const payload = await request({
              method: "GET",
              ...riskRequest,
              requiredScope: riskScopes[risk],
              overallDeadlineAt: deadlineAt
            });
            const records = getArray(payload, riskArrayKeys(risk));

            if ((getNonNegativeCount(payload) ?? 0) > 0) {
              return "FOUND";
            }

            if (!records) {
              return "MALFORMED";
            }

            return records.length === 0 ? "CLEAR" : "FOUND";
          } catch (error) {
            if (error instanceof GhlReconciliationReadError) {
              if (error.kind === "MISSING_SCOPE" || error.kind === "MALFORMED" || error.kind === "UNAVAILABLE") {
                return error.kind;
              }

              return "UNAVAILABLE";
            }

            return "UNAVAILABLE";
          }
        }
      };
    }
  };
}

export const ghlReconciliationReadClient = createGhlReconciliationReadClient();
