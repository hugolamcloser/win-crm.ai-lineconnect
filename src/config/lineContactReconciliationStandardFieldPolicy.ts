const transferableBusinessFields = new Set([
  "firstname",
  "lastname",
  "name",
  "email",
  "phone",
  "address1",
  "city",
  "state",
  "country",
  "postalcode",
  "website",
  "companyname",
  "dateofbirth"
]);

const ignoredMetadataFields = new Set([
  "id",
  "contactid",
  "locationid",
  "location_id",
  "createdat",
  "updatedat",
  "dateadded",
  "dateupdated",
  "deleted",
  "deletedat",
  "lastactivity",
  "lastactivitydate",
  "lastcontacted",
  "validemail",
  "links",
  "_links",
  "tags",
  "customfields"
]);

const protectedOrUnsupportedBusinessFields = new Set([
  "assignedto",
  "source",
  "dnd",
  "dndsettings",
  "additionalemails",
  "additionalphones",
  "timezone",
  "companyid",
  "company",
  "type",
  "followers",
  "followersids",
  "attributions",
  "attributionsource",
  "lastattributionsource",
  "businessid"
]);

export type ReconciliationStandardFieldClassification =
  | "TRANSFERABLE"
  | "IGNORED_METADATA"
  | "PROTECTED_OR_UNSUPPORTED"
  | "UNCLASSIFIED";

export function classifyReconciliationStandardField(fieldName: string): ReconciliationStandardFieldClassification {
  const normalized = fieldName.trim().toLowerCase();

  if (transferableBusinessFields.has(normalized)) {
    return "TRANSFERABLE";
  }

  if (ignoredMetadataFields.has(normalized)) {
    return "IGNORED_METADATA";
  }

  if (protectedOrUnsupportedBusinessFields.has(normalized)) {
    return "PROTECTED_OR_UNSUPPORTED";
  }

  return "UNCLASSIFIED";
}

export function hasNonEmptyReconciliationStandardValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return Boolean(value.trim());
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value as object).length > 0;
  }

  return true;
}

export const reconciliationStandardFieldPolicyDocumentation = {
  transferableBusinessFields: [...transferableBusinessFields],
  ignoredMetadataFields: [...ignoredMetadataFields],
  protectedOrUnsupportedBusinessFields: [...protectedOrUnsupportedBusinessFields],
  unknownNonEmptyFieldsFailClosed: true
} as const;
