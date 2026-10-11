import { isEvery8dSettingsAuthKeyVersion } from "../utils/every8dSettingsAuthKeyVersion";

export const every8dSettingsAuthConfigurationErrorMessage =
  "EVERY8D settings auth configuration is incomplete or invalid";

export type Every8dSettingsAuthConfigurationErrorCategory =
  | "invalid_feature_flag"
  | "incomplete_hmac_configuration"
  | "invalid_keyring"
  | "invalid_active_key_version";

export class Every8dSettingsAuthConfigurationError extends Error {
  readonly category: Every8dSettingsAuthConfigurationErrorCategory;

  constructor(category: Every8dSettingsAuthConfigurationErrorCategory = "invalid_keyring") {
    super(every8dSettingsAuthConfigurationErrorMessage);
    this.name = "Every8dSettingsAuthConfigurationError";
    this.category = category;
  }
}

export interface Every8dSettingsAuthHmacKeyring {
  readonly has: (version: string) => boolean;
  readonly get: (version: string) => Buffer | undefined;
  readonly versions: () => string[];
}

export type Every8dSettingsAuthHmacConfig = {
  readonly activeKeyVersion: string;
  readonly keys: Every8dSettingsAuthHmacKeyring;
};

export type Every8dSettingsAuthConfig = {
  readonly enabled: boolean;
  readonly emailPseudonymHmac: Every8dSettingsAuthHmacConfig | null;
  readonly otpHmac: Every8dSettingsAuthHmacConfig | null;
};

const encodedKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const jsonWhitespace = new Set([" ", "\t", "\r", "\n"]);

const hmacEnvironmentNames = [
  "EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION",
  "EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS",
  "EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION",
  "EVERY8D_SETTINGS_OTP_HMAC_KEYS"
] as const;

type HmacEnvironmentName = typeof hmacEnvironmentNames[number];

class EncapsulatedEvery8dSettingsAuthHmacKeyring implements Every8dSettingsAuthHmacKeyring {
  readonly #keys: Map<string, Buffer>;

  constructor(entries: Iterable<readonly [string, Buffer]>) {
    this.#keys = new Map();
    for (const [version, key] of entries) {
      if (
        !isEvery8dSettingsAuthKeyVersion(version) ||
        !Buffer.isBuffer(key) ||
        key.length !== 32 ||
        this.#keys.has(version)
      ) {
        invalidConfig("invalid_keyring");
      }
      this.#keys.set(version, Buffer.from(key));
    }
    if (this.#keys.size === 0) invalidConfig("invalid_keyring");
    Object.freeze(this);
  }

  has(version: string): boolean {
    return this.#keys.has(version);
  }

  get(version: string): Buffer | undefined {
    const key = this.#keys.get(version);
    return key ? Buffer.from(key) : undefined;
  }

  versions(): string[] {
    return Array.from(this.#keys.keys());
  }
}

Object.freeze(EncapsulatedEvery8dSettingsAuthHmacKeyring.prototype);

function invalidConfig(category: Every8dSettingsAuthConfigurationErrorCategory): never {
  throw new Every8dSettingsAuthConfigurationError(category);
}

function skipJsonWhitespace(value: string, cursor: number): number {
  while (cursor < value.length && jsonWhitespace.has(value[cursor]!)) cursor += 1;
  return cursor;
}

function parseJsonString(value: string, start: number): { value: string; cursor: number } {
  if (value[start] !== "\"") invalidConfig("invalid_keyring");

  let cursor = start + 1;
  while (cursor < value.length) {
    const character = value[cursor]!;
    const code = value.charCodeAt(cursor);

    if (character === "\"") {
      const literal = value.slice(start, cursor + 1);
      try {
        const parsed = JSON.parse(literal) as unknown;
        if (typeof parsed !== "string") invalidConfig("invalid_keyring");
        return { value: parsed, cursor: cursor + 1 };
      } catch {
        invalidConfig("invalid_keyring");
      }
    }

    if (character === "\\") {
      cursor += 1;
      if (cursor >= value.length) invalidConfig("invalid_keyring");
      const escaped = value[cursor]!;
      if (escaped === "u") {
        const digits = value.slice(cursor + 1, cursor + 5);
        if (digits.length !== 4 || !/^[0-9A-Fa-f]{4}$/.test(digits)) {
          invalidConfig("invalid_keyring");
        }
        cursor += 5;
        continue;
      }
      if (!/["\\/bfnrt]/.test(escaped)) invalidConfig("invalid_keyring");
      cursor += 1;
      continue;
    }

    if (code < 0x20) invalidConfig("invalid_keyring");
    cursor += 1;
  }

  return invalidConfig("invalid_keyring");
}

function parseStringKeyringObject(rawValue: string): Map<string, string> {
  let cursor = skipJsonWhitespace(rawValue, 0);
  if (rawValue[cursor] !== "{") invalidConfig("invalid_keyring");
  cursor = skipJsonWhitespace(rawValue, cursor + 1);

  const entries = new Map<string, string>();
  const memberNames = new Set<string>();
  if (rawValue[cursor] === "}") {
    cursor = skipJsonWhitespace(rawValue, cursor + 1);
    if (cursor !== rawValue.length) invalidConfig("invalid_keyring");
    return entries;
  }

  while (cursor < rawValue.length) {
    const member = parseJsonString(rawValue, cursor);
    if (memberNames.has(member.value)) invalidConfig("invalid_keyring");
    memberNames.add(member.value);

    cursor = skipJsonWhitespace(rawValue, member.cursor);
    if (rawValue[cursor] !== ":") invalidConfig("invalid_keyring");
    cursor = skipJsonWhitespace(rawValue, cursor + 1);

    const encodedKey = parseJsonString(rawValue, cursor);
    entries.set(member.value, encodedKey.value);
    cursor = skipJsonWhitespace(rawValue, encodedKey.cursor);

    if (rawValue[cursor] === "}") {
      cursor = skipJsonWhitespace(rawValue, cursor + 1);
      if (cursor !== rawValue.length) invalidConfig("invalid_keyring");
      return entries;
    }
    if (rawValue[cursor] !== ",") invalidConfig("invalid_keyring");
    cursor = skipJsonWhitespace(rawValue, cursor + 1);
    if (rawValue[cursor] === "}") invalidConfig("invalid_keyring");
  }

  return invalidConfig("invalid_keyring");
}

export function parseEvery8dSettingsAuthHmacKeyring(
  rawValue: string
): Every8dSettingsAuthHmacKeyring {
  try {
    if (typeof rawValue !== "string" || rawValue.length === 0) {
      invalidConfig("invalid_keyring");
    }

    const encodedEntries = parseStringKeyringObject(rawValue);
    if (encodedEntries.size === 0) invalidConfig("invalid_keyring");

    const keys: Array<readonly [string, Buffer]> = [];
    for (const [version, encodedKey] of encodedEntries) {
      if (!isEvery8dSettingsAuthKeyVersion(version) || !encodedKeyPattern.test(encodedKey)) {
        invalidConfig("invalid_keyring");
      }

      const decodedKey = Buffer.from(encodedKey, "base64url");
      if (decodedKey.length !== 32 || decodedKey.toString("base64url") !== encodedKey) {
        invalidConfig("invalid_keyring");
      }
      keys.push([version, decodedKey]);
    }

    return new EncapsulatedEvery8dSettingsAuthHmacKeyring(keys);
  } catch {
    return invalidConfig("invalid_keyring");
  }
}

function parseFeatureFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return invalidConfig("invalid_feature_flag");
}

function hasOwnEnvironmentProperty(
  source: NodeJS.ProcessEnv,
  name: HmacEnvironmentName
): boolean {
  return Object.prototype.hasOwnProperty.call(source, name);
}

function parseHmacConfig(
  activeKeyVersion: string | undefined,
  rawKeyring: string | undefined
): Every8dSettingsAuthHmacConfig {
  if (
    typeof activeKeyVersion !== "string" ||
    !isEvery8dSettingsAuthKeyVersion(activeKeyVersion) ||
    typeof rawKeyring !== "string" ||
    rawKeyring.length === 0
  ) {
    return invalidConfig("invalid_active_key_version");
  }

  const keys = parseEvery8dSettingsAuthHmacKeyring(rawKeyring);
  if (!keys.has(activeKeyVersion)) invalidConfig("invalid_active_key_version");
  return Object.freeze({ activeKeyVersion, keys });
}

export function readEvery8dSettingsAuthConfig(
  source: NodeJS.ProcessEnv = process.env
): Every8dSettingsAuthConfig {
  const enabled = parseFeatureFlag(source.EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED);
  const suppliedCount = hmacEnvironmentNames.filter((name) =>
    hasOwnEnvironmentProperty(source, name)
  ).length;

  if (suppliedCount === 0) {
    if (enabled) invalidConfig("incomplete_hmac_configuration");
    return Object.freeze({ enabled: false, emailPseudonymHmac: null, otpHmac: null });
  }
  if (suppliedCount !== hmacEnvironmentNames.length) {
    return invalidConfig("incomplete_hmac_configuration");
  }

  const emailPseudonymHmac = parseHmacConfig(
    source.EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION,
    source.EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS
  );
  const otpHmac = parseHmacConfig(
    source.EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION,
    source.EVERY8D_SETTINGS_OTP_HMAC_KEYS
  );

  return Object.freeze({ enabled, emailPseudonymHmac, otpHmac });
}
