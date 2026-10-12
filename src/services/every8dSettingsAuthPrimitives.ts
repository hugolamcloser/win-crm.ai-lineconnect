import crypto from "node:crypto";
import type {
  Every8dSettingsAuthHmacConfig,
  Every8dSettingsAuthHmacKeyring
} from "../config/every8dSettingsAuth";
import { isEvery8dSettingsAuthKeyVersion } from "../utils/every8dSettingsAuthKeyVersion";

export const every8dSettingsOtpAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type Every8dSettingsAuthPurpose = "login" | "enrollment";

const requestCapabilityPattern = /^[A-Za-z0-9_-]{43}$/;
const localAtom = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const localPartPattern = new RegExp(`^${localAtom}(?:\\.${localAtom})*$`);
const domainLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const uuidPattern = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const emailPseudonymDomain = Buffer.from(
  "wincrm/every8d/settings/email-pseudonym/v1",
  "utf8"
);
const otpHmacDomain = Buffer.from("wincrm/every8d/settings/otp/v1", "utf8");
const nul = Buffer.from([0]);

function primitiveError(kind: string): Error {
  return new Error(`EVERY8D settings auth ${kind} is invalid`);
}

function selectKey(keyring: Every8dSettingsAuthHmacKeyring, keyVersion: string): Buffer {
  if (!isEvery8dSettingsAuthKeyVersion(keyVersion)) {
    throw primitiveError("key selection");
  }
  const selected = keyring.get(keyVersion);
  if (!Buffer.isBuffer(selected) || selected.length !== 32) {
    throw primitiveError("key selection");
  }
  return selected;
}

export function normalizeEvery8dSettingsEmail(input: unknown): string {
  if (typeof input !== "string") throw primitiveError("email");

  const normalizedInput = input.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!/^[\x00-\x7F]*$/.test(normalizedInput)) throw primitiveError("email");

  const atIndex = normalizedInput.indexOf("@");
  if (atIndex < 0 || atIndex !== normalizedInput.lastIndexOf("@")) {
    throw primitiveError("email");
  }

  const localPart = normalizedInput.slice(0, atIndex);
  const inputDomain = normalizedInput.slice(atIndex + 1);
  const domain = inputDomain.toLowerCase();
  if (
    localPart.length < 1 ||
    localPart.length > 64 ||
    !localPartPattern.test(localPart) ||
    domain.length < 1 ||
    domain.length > 253
  ) {
    throw primitiveError("email");
  }

  const labels = domain.split(".");
  if (labels.some((label) => label.length < 1 || label.length > 63 || !domainLabelPattern.test(label))) {
    throw primitiveError("email");
  }

  const normalized = `${localPart}@${domain}`;
  if (normalized.length > 254) throw primitiveError("email");
  return normalized;
}

export function parseEvery8dSettingsRequestCapability(value: unknown): Buffer {
  if (typeof value !== "string" || !requestCapabilityPattern.test(value)) {
    throw primitiveError("request capability");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    throw primitiveError("request capability");
  }
  return decoded;
}

export function generateEvery8dSettingsRequestCapability(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashEvery8dSettingsRequestCapability(value: unknown): Buffer {
  return crypto.createHash("sha256").update(parseEvery8dSettingsRequestCapability(value)).digest();
}

export function deriveEvery8dSettingsEmailPseudonym(input: {
  normalizedEmail: string;
  keyVersion: string;
  keyring: Every8dSettingsAuthHmacKeyring;
}): string {
  if (normalizeEvery8dSettingsEmail(input.normalizedEmail) !== input.normalizedEmail) {
    throw primitiveError("email pseudonym input");
  }
  const key = selectKey(input.keyring, input.keyVersion);
  const digest = crypto.createHmac("sha256", key).update(Buffer.concat([
    emailPseudonymDomain,
    nul,
    Buffer.from(input.normalizedEmail, "utf8")
  ])).digest("hex");
  return `${input.keyVersion}:${digest}`;
}

export function deriveActiveEvery8dSettingsEmailPseudonym(input: {
  normalizedEmail: string;
  hmacConfig: Every8dSettingsAuthHmacConfig;
}): string {
  return deriveEvery8dSettingsEmailPseudonym({
    normalizedEmail: input.normalizedEmail,
    keyVersion: input.hmacConfig.activeKeyVersion,
    keyring: input.hmacConfig.keys
  });
}

export function deriveEvery8dSettingsEmailPseudonyms(input: {
  normalizedEmail: string;
  keyring: Every8dSettingsAuthHmacKeyring;
}): string[] {
  return input.keyring.versions().sort().map((keyVersion) =>
    deriveEvery8dSettingsEmailPseudonym({ ...input, keyVersion })
  );
}

export function encodeEvery8dSettingsOtp(entropy: Buffer): string {
  if (!Buffer.isBuffer(entropy) || entropy.length !== 5) {
    throw primitiveError("OTP entropy");
  }

  let otp = "";
  for (let group = 0; group < 8; group += 1) {
    let alphabetIndex = 0;
    for (let offset = 0; offset < 5; offset += 1) {
      const bitIndex = group * 5 + offset;
      const byte = entropy[Math.floor(bitIndex / 8)]!;
      const bit = (byte >> (7 - (bitIndex % 8))) & 1;
      alphabetIndex = (alphabetIndex << 1) | bit;
    }
    otp += every8dSettingsOtpAlphabet[alphabetIndex]!;
  }
  return otp;
}

export function generateEvery8dSettingsOtp(): string {
  return encodeEvery8dSettingsOtp(crypto.randomBytes(5));
}

export function formatEvery8dSettingsOtp(value: unknown): string {
  const otp = parseEvery8dSettingsOtp(value);
  return `${otp.slice(0, 4)}-${otp.slice(4)}`;
}

export function parseEvery8dSettingsOtp(value: unknown): string {
  if (typeof value !== "string" || !/^[\x00-\x7F]+$/.test(value)) {
    throw primitiveError("OTP");
  }
  if (value.length !== 8 && !(value.length === 9 && value[4] === "-")) {
    throw primitiveError("OTP");
  }

  const canonical = (value.length === 9 ? value.slice(0, 4) + value.slice(5) : value).toUpperCase();
  if (canonical.length !== 8 || Array.from(canonical).some((character) =>
    !every8dSettingsOtpAlphabet.includes(character)
  )) {
    throw primitiveError("OTP");
  }
  return canonical;
}

export function decodeEvery8dSettingsChallengeUuid(value: unknown): Buffer {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw primitiveError("challenge UUID");
  }
  const decoded = Buffer.from(value.replace(/-/g, ""), "hex");
  if (decoded.length !== 16) throw primitiveError("challenge UUID");
  return decoded;
}

export function deriveEvery8dSettingsOtpHmac(input: {
  purpose: Every8dSettingsAuthPurpose;
  challengeId: string;
  otp: unknown;
  keyVersion: string;
  keyring: Every8dSettingsAuthHmacKeyring;
}): Buffer {
  if (input.purpose !== "login" && input.purpose !== "enrollment") {
    throw primitiveError("OTP purpose");
  }
  const key = selectKey(input.keyring, input.keyVersion);
  const challengeBytes = decodeEvery8dSettingsChallengeUuid(input.challengeId);
  const otp = parseEvery8dSettingsOtp(input.otp);
  return crypto.createHmac("sha256", key).update(Buffer.concat([
    otpHmacDomain,
    nul,
    Buffer.from(input.purpose, "utf8"),
    nul,
    challengeBytes,
    nul,
    Buffer.from(otp, "ascii")
  ])).digest();
}

export function deriveActiveEvery8dSettingsOtpHmac(input: {
  purpose: Every8dSettingsAuthPurpose;
  challengeId: string;
  otp: unknown;
  hmacConfig: Every8dSettingsAuthHmacConfig;
}): { keyVersion: string; hmac: Buffer } {
  const keyVersion = input.hmacConfig.activeKeyVersion;
  return {
    keyVersion,
    hmac: deriveEvery8dSettingsOtpHmac({
      purpose: input.purpose,
      challengeId: input.challengeId,
      otp: input.otp,
      keyVersion,
      keyring: input.hmacConfig.keys
    })
  };
}
