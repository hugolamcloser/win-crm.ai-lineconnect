import type { Every8dSettingsAuthHmacConfig, Every8dSettingsAuthHmacKeyring } from "./every8dSettingsAuth";

export type Every8dSettingsEmailOutboxEncryptionConfig = Readonly<{
  activeKeyVersion: string;
  keys: Every8dSettingsAuthHmacKeyring;
}>;

export class Every8dSettingsEmailOutboxConfigurationError extends Error {
  constructor() {
    super("EVERY8D settings email outbox configuration is invalid");
    this.name = "Every8dSettingsEmailOutboxConfigurationError";
  }
}

function invalidOutboxConfig(_category?: string): never {
  throw new Every8dSettingsEmailOutboxConfigurationError();
}

export function isEvery8dSettingsEmailOutboxKeyVersion(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,63}$/.exec(value)?.[0] === value;
}

class EncryptionKeyring implements Every8dSettingsAuthHmacKeyring {
  readonly #keys: Map<string, Buffer>;
  constructor(entries: readonly (readonly [string, Buffer])[]) {
    this.#keys = new Map(entries.map(([version, key]) => [version, Buffer.from(key)]));
    Object.freeze(this);
  }
  has(version: string): boolean { return this.#keys.has(version); }
  get(version: string): Buffer | undefined {
    const key = this.#keys.get(version);
    return key ? Buffer.from(key) : undefined;
  }
  versions(): string[] { return [...this.#keys.keys()]; }
}
Object.freeze(EncryptionKeyring.prototype);
const jsonWhitespace = new Set([" ", "\t", "\r", "\n"]);

function skipJsonWhitespace(value: string, cursor: number): number {
  while (cursor < value.length && jsonWhitespace.has(value[cursor]!)) cursor += 1;
  return cursor;
}

function parseJsonString(value: string, start: number): { value: string; cursor: number } {
  if (value[start] !== "\"") invalidOutboxConfig("invalid_keyring");

  let cursor = start + 1;
  while (cursor < value.length) {
    const character = value[cursor]!;
    const code = value.charCodeAt(cursor);

    if (character === "\"") {
      const literal = value.slice(start, cursor + 1);
      try {
        const parsed = JSON.parse(literal) as unknown;
        if (typeof parsed !== "string") invalidOutboxConfig("invalid_keyring");
        return { value: parsed, cursor: cursor + 1 };
      } catch {
        invalidOutboxConfig("invalid_keyring");
      }
    }

    if (character === "\\") {
      cursor += 1;
      if (cursor >= value.length) invalidOutboxConfig("invalid_keyring");
      const escaped = value[cursor]!;
      if (escaped === "u") {
        const digits = value.slice(cursor + 1, cursor + 5);
        if (digits.length !== 4 || !/^[0-9A-Fa-f]{4}$/.test(digits)) {
          invalidOutboxConfig("invalid_keyring");
        }
        cursor += 5;
        continue;
      }
      if (!/["\\/bfnrt]/.test(escaped)) invalidOutboxConfig("invalid_keyring");
      cursor += 1;
      continue;
    }

    if (code < 0x20) invalidOutboxConfig("invalid_keyring");
    cursor += 1;
  }

  return invalidOutboxConfig("invalid_keyring");
}

function parseStringKeyringObject(rawValue: string): Map<string, string> {
  let cursor = skipJsonWhitespace(rawValue, 0);
  if (rawValue[cursor] !== "{") invalidOutboxConfig("invalid_keyring");
  cursor = skipJsonWhitespace(rawValue, cursor + 1);

  const entries = new Map<string, string>();
  const memberNames = new Set<string>();
  if (rawValue[cursor] === "}") {
    cursor = skipJsonWhitespace(rawValue, cursor + 1);
    if (cursor !== rawValue.length) invalidOutboxConfig("invalid_keyring");
    return entries;
  }

  while (cursor < rawValue.length) {
    const member = parseJsonString(rawValue, cursor);
    if (memberNames.has(member.value)) invalidOutboxConfig("invalid_keyring");
    memberNames.add(member.value);

    cursor = skipJsonWhitespace(rawValue, member.cursor);
    if (rawValue[cursor] !== ":") invalidOutboxConfig("invalid_keyring");
    cursor = skipJsonWhitespace(rawValue, cursor + 1);

    const encodedKey = parseJsonString(rawValue, cursor);
    entries.set(member.value, encodedKey.value);
    cursor = skipJsonWhitespace(rawValue, encodedKey.cursor);

    if (rawValue[cursor] === "}") {
      cursor = skipJsonWhitespace(rawValue, cursor + 1);
      if (cursor !== rawValue.length) invalidOutboxConfig("invalid_keyring");
      return entries;
    }
    if (rawValue[cursor] !== ",") invalidOutboxConfig("invalid_keyring");
    cursor = skipJsonWhitespace(rawValue, cursor + 1);
    if (rawValue[cursor] === "}") invalidOutboxConfig("invalid_keyring");
  }

  return invalidOutboxConfig("invalid_keyring");
}


export function parseEvery8dSettingsEmailOutboxKeyring(raw: string): Every8dSettingsAuthHmacKeyring {
  try {
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 16384 || raw.length === 0) {
      invalidOutboxConfig();
    }
    const entries = parseStringKeyringObject(raw);
    if (entries.size < 1 || entries.size > 64) invalidOutboxConfig();
    const decoded: Array<readonly [string, Buffer]> = [];
    for (const [version, encoded] of entries) {
      if (!isEvery8dSettingsEmailOutboxKeyVersion(version) || encoded.length !== 43 ||
        !/^[A-Za-z0-9_-]{43}$/.test(encoded)) invalidOutboxConfig();
      const key = Buffer.from(encoded, "base64url");
      if (key.length !== 32 || key.toString("base64url") !== encoded ||
        decoded.some(([, previous]) => previous.equals(key))) invalidOutboxConfig();
      decoded.push([version, key]);
    }
    return new EncryptionKeyring(decoded);
  } catch { return invalidOutboxConfig(); }
}

export function readEvery8dSettingsEmailOutboxEncryptionConfig(
  source: NodeJS.ProcessEnv,
  hmacDomains: readonly (Every8dSettingsAuthHmacConfig | null)[]
): Every8dSettingsEmailOutboxEncryptionConfig | null {
  const activeName = "EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION";
  const keysName = "EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS";
  const supplied = [activeName, keysName].filter((name) =>
    Object.prototype.hasOwnProperty.call(source, name)).length;
  if (supplied === 0) return null;
  try {
    const activeKeyVersion = source[activeName];
    const raw = source[keysName];
    if (supplied !== 2 || !isEvery8dSettingsEmailOutboxKeyVersion(activeKeyVersion) ||
      typeof raw !== "string") invalidOutboxConfig();
    const keys = parseEvery8dSettingsEmailOutboxKeyring(raw);
    if (!keys.has(activeKeyVersion)) invalidOutboxConfig();
    const domains = [...hmacDomains.filter((domain): domain is Every8dSettingsAuthHmacConfig =>
      domain !== null).map((domain) => domain.keys), keys];
    for (let left = 0; left < domains.length; left += 1) {
      for (let right = left + 1; right < domains.length; right += 1) {
        for (const version of domains[left]!.versions()) {
          const key = domains[left]!.get(version);
          if (!key || key.length !== 32) invalidOutboxConfig();
          for (const otherVersion of domains[right]!.versions()) {
            const other = domains[right]!.get(otherVersion);
            if (!other || other.length !== 32 || key.equals(other)) invalidOutboxConfig();
          }
        }
      }
    }
    return Object.freeze({ activeKeyVersion, keys });
  } catch { return invalidOutboxConfig(); }
}
