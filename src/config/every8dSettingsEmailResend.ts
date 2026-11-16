/** Validate local header containment without inspecting the credential's provider state. */
export function parseEvery8dSettingsEmailResendApiKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 1 ||
      Buffer.byteLength(value, "utf8") > 256 || /[^\x21-\x7e]/.test(value)) {
    throw new Error("Invalid Resend email configuration.");
  }
  return value;
}
