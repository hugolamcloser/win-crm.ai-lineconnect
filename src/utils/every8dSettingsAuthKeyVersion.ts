const every8dSettingsAuthKeyVersionPattern = /^[A-Za-z0-9_.-]{1,63}$/;

export function isEvery8dSettingsAuthKeyVersion(value: unknown): value is string {
  return typeof value === "string" && every8dSettingsAuthKeyVersionPattern.test(value);
}
