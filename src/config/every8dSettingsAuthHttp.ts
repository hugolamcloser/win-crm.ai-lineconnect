import { domainToASCII, domainToUnicode } from "node:url";

export class Every8dSettingsAuthHttpConfigurationError extends Error {
  constructor() {
    super("Invalid EVERY8D settings auth HTTP configuration");
    this.name = "Every8dSettingsAuthHttpConfigurationError";
  }
}

export type Every8dSettingsAuthHttpConfig =
  | Readonly<{ operational: false; publicOrigin: string | undefined }>
  | Readonly<{ operational: true; publicOrigin: string }>;

function invalidConfiguration(): never {
  throw new Every8dSettingsAuthHttpConfigurationError();
}

function parseFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return invalidConfiguration();
}

function isCanonicalDnsLabel(label: string): boolean {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
  if (!label.startsWith("xn--")) return true;

  const unicode = domainToUnicode(label);
  return unicode !== "" && unicode !== label && domainToASCII(unicode) === label;
}

export function parseEvery8dSettingsAuthPublicOrigin(value: string): string {
  if (typeof value !== "string" || /[^\x21-\x7e]/.test(value)) return invalidConfiguration();
  const origin = value.endsWith("/") ? value.slice(0, -1) : value;
  const authority = /^https:\/\/(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/.exec(origin);
  if (!authority) return invalidConfiguration();

  const [, host, port] = authority;
  if (port !== undefined && (port === "443" || Number(port) > 65535)) return invalidConfiguration();
  if (!host.startsWith("[") && (host.length > 253 || !host.split(".").every(isCanonicalDnsLabel))) {
    return invalidConfiguration();
  }

  // Exact equality also rejects shorthand IPv4, uncompressed IPv6 and URL repair.
  const parsed = URL.canParse(origin) ? new URL(origin) : undefined;
  if (parsed?.origin !== origin) return invalidConfiguration();
  return origin;
}

export function readEvery8dSettingsAuthHttpConfig(
  source: NodeJS.ProcessEnv = process.env
): Every8dSettingsAuthHttpConfig {
  const challengesEnabled = parseFlag(source.EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED);
  const httpEnabled = parseFlag(source.EVERY8D_SETTINGS_AUTH_HTTP_ENABLED);
  const baseUrl = source.EVERY8D_SETTINGS_AUTH_PUBLIC_BASE_URL;
  const publicOrigin = baseUrl === undefined ? undefined : parseEvery8dSettingsAuthPublicOrigin(baseUrl);
  if (!challengesEnabled || !httpEnabled) return Object.freeze({ operational: false, publicOrigin });
  if (publicOrigin === undefined) return invalidConfiguration();
  return Object.freeze({ operational: true, publicOrigin });
}
