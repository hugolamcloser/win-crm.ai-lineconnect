export const EVERY8D_SETTINGS_AUTH_MAX_BODY_BYTES = 8192;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
// The sticky token pattern reads a single JSON string. JSON.parse decodes only that token.
const stringToken = /"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const whitespace = /[\x20\t\n\r]*/y;

export type Every8dSettingsAuthJsonEnvelope = Readonly<Record<string, string>>;

/** All admitted fields are required strings. Their meaning is owned by later handlers. */
export function parseEvery8dSettingsAuthJsonEnvelope(
  bytes: Uint8Array,
  fields: readonly string[]
): Every8dSettingsAuthJsonEnvelope | undefined {
  if (bytes.byteLength > EVERY8D_SETTINGS_AUTH_MAX_BODY_BYTES) return undefined;
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return undefined;
  }

  let offset = 0;
  const read = (token: string): boolean => {
    whitespace.lastIndex = offset;
    whitespace.exec(text);
    offset = whitespace.lastIndex;
    if (text[offset] !== token) return false;
    offset++;
    return true;
  };
  const readString = (): string | undefined => {
    whitespace.lastIndex = offset;
    whitespace.exec(text);
    stringToken.lastIndex = whitespace.lastIndex;
    const match = stringToken.exec(text);
    if (!match) return undefined;
    offset = stringToken.lastIndex;
    return JSON.parse(match[0]) as string;
  };

  if (!read("{")) return undefined;
  const envelope: Record<string, string> = Object.create(null);
  for (let count = 0; count < fields.length; count++) {
    if (count > 0 && !read(",")) return undefined;
    const key = readString();
    if (key === undefined || !fields.includes(key) || Object.hasOwn(envelope, key) ||
      !read(":")) return undefined;
    const value = readString();
    if (value === undefined) return undefined;
    envelope[key] = value;
  }
  if (!read("}")) return undefined;
  whitespace.lastIndex = offset;
  whitespace.exec(text);
  if (whitespace.lastIndex !== text.length) return undefined;
  return Object.freeze(envelope);
}
