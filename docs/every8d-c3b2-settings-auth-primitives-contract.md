# EVERY8D C3b-2 settings authentication primitives contract

## Status and boundary

This document freezes the configuration and cryptographic contracts required by
the later C3b-2 pure TypeScript primitives. It resolves the contract gaps found
during the first C3b-2 implementation attempt. It does not implement those
primitives or activate settings authentication.

C3b-2 remains route-free, database-write-free, session-free, provider-free,
email-provider-free, SMS-free, LINE-free, and disabled from live use. This
contract does not change the C3b-1 migration, database behavior, production
configuration, or Railway configuration. C3b-3 owns orchestration, persistence,
alias locking, and challenge lifecycle integration.

## Feature gate

The only feature flag is:

`EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED`

Its accepted values and behavior are exact:

- an absent or empty value disables the feature;
- the exact string `false` disables the feature;
- the exact string `true` enables the feature; and
- every other non-empty value is a configuration error.

The default is false. C3b-2 must not enable the flag anywhere. No aliases or
fallback flag names are permitted.

## HMAC configuration

The exact environment-variable names are:

- `EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION`
- `EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS`
- `EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION`
- `EVERY8D_SETTINGS_OTP_HMAC_KEYS`

No aliases or fallback names are permitted. Email-pseudonym and OTP keys are
separate configuration domains and must not be shared implicitly.

### Key versions

Both key-version namespaces use this exact ASCII grammar:

```text
^[A-Za-z0-9_.-]{1,63}$
```

This matches the C3b-1 database grammar. When challenge authentication is
enabled, each active key version must identify a key in its corresponding
keyring. A missing stored OTP key version during later verification, or a
missing historical email-pseudonym key required for alias reconstruction, must
fail closed.

### Keyring serialization and keys

Each `*_HMAC_KEYS` value is a JSON object whose property names are key versions
and whose property values are HMAC keys. The JSON value must be a plain object,
not an array, `null`, or another scalar. An example of shape only is:

```json
{"k1":"<canonical-unpadded-base64url-key>"}
```

The raw JSON text must be parsed with duplicate-member detection before the
final keyring map or object is materialized. Duplicate object member names are
invalid, including two members with the same key-version spelling. Neither
first-value-wins nor last-value-wins behavior is permitted, and an ordinary
`JSON.parse()` result must not be used if duplicate evidence has already been
discarded. For example, `{"k1":"AAA...","k1":"BBB..."}` must be rejected.
Nested objects are outside the keyring grammar; every member value must be a
string.

Every property must satisfy all of these requirements:

- the property name matches `^[A-Za-z0-9_.-]{1,63}$`;
- the value is canonical unpadded Base64URL;
- the encoded value is exactly 43 ASCII characters;
- the alphabet is only `A-Z`, `a-z`, `0-9`, `-`, and `_`;
- padding (`=`) and alternate Base64 encodings are rejected;
- the decoded value is exactly 32 bytes; and
- decoding and re-encoding as unpadded Base64URL produces the supplied value
  byte-for-byte.

For these four HMAC variables, `supplied` means that the environment property
exists. A present property whose value is the empty string is supplied and is
invalid. If none of the four variables is supplied, disabled mode is valid
without HMAC configuration. If any one or more is supplied, all four must be
supplied and the complete configuration must pass the same strict validation
used for enabled mode: both keyrings must be non-empty, both active versions
must satisfy the key-version grammar, and each active version must exist in its
corresponding keyring. This validation does not enable the feature.

The resulting cases are exact:

- disabled and no HMAC variables supplied: valid;
- disabled and all four supplied with a valid complete configuration: valid,
  but the feature remains disabled;
- disabled and partial or malformed HMAC configuration: configuration error;
- enabled and missing, partial, or malformed HMAC configuration: configuration
  error; and
- enabled and all four supplied with a valid complete configuration: eligible
  for later runtime activation.

There is no silent-ignore behavior. Runtime challenge authentication cannot
activate until the complete enabled configuration is valid. Long-lived keys
must never be generated automatically.

Keyrings support rotation. New derivations use the active version. Retained
older versions remain available for historical challenges and pseudonyms.
Removing a version that historical authority still depends on causes the
dependent verification or alias reconstruction to fail closed.

## Email normalization clarification

TypeScript normalization must:

- require a string input;
- trim surrounding ASCII SP (`0x20`) and HTAB (`0x09`) only;
- reject every other surrounding or interior whitespace/control character;
- reject non-ASCII input;
- require exactly one `@`;
- preserve local-part case and perform no provider-specific rewrite, alias
  removal, or Unicode normalization;
- require an ASCII unquoted dot-atom local part of 1 through 64 bytes, with no
  leading, trailing, or consecutive dot;
- accept ASCII uppercase letters in the input domain, then lowercase the domain;
- require the normalized domain to be 1 through 253 bytes, with labels of 1
  through 63 bytes containing lowercase ASCII letters, digits, and internal
  hyphens, and beginning and ending with an alphanumeric character; and
- require the complete normalized address to be at most 254 bytes.

The C3b-1 SQL function validates canonical values only. TypeScript performs the
domain-lowercasing transformation before the value reaches that validator.

## Email pseudonym HMAC

The algorithm is HMAC-SHA256 with the selected dedicated email-pseudonym key.
The message bytes are exactly:

```text
UTF8("wincrm/every8d/settings/email-pseudonym/v1")
|| 0x00
|| UTF8(normalized_email)
```

There is no trailing NUL, JSON serialization, length prefix, or key version in
the HMAC message. The output encoding is:

```text
<key-version>:<64 lowercase hex>
```

The version prefixes the encoded result but is not part of the HMAC input.

### Public fixed vector

This vector is public test data and is never a production key.

```text
key version:       k1
key Base64URL:     AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
normalized email: Alice@example.com
HMAC hex:          a84dfc16aa086bfa11b69876adab6d5f7da2cf9c10aca8b6789703b035639ee8
pseudonym:         k1:a84dfc16aa086bfa11b69876adab6d5f7da2cf9c10aca8b6789703b035639ee8
```

## OTP generation and input normalization

Generated OTPs use exactly this alphabet:

```text
0123456789ABCDEFGHJKMNPQRSTVWXYZ
```

Generation encodes exactly five CSPRNG bytes (40 bits) directly as eight 5-bit
symbols. Read the bytes from left to right. Within each byte, read bits from the
most-significant bit (bit 7) to the least-significant bit (bit 0). Concatenate
those bits into one 40-bit stream, split it from left to right into eight
consecutive 5-bit groups, interpret each group as an unsigned integer from 0
through 31, and use that integer as the index into the alphabet above. Byte
reversal, little-endian integer interpretation, LSB-first extraction, modulo
reduction, and rejection sampling are forbidden. Rejection sampling is
unnecessary because every group is exactly 5 bits. The canonical generated form
is eight uppercase symbols. The display form is `XXXX-XXXX`.

### Public generation vector

This vector is public test data and contains no production entropy or key
material.

```text
entropy bytes: 00 11 22 33 44
5-bit groups:  00000 00000 01000 10010 00100 01100 11010 00100
indices:       0, 0, 8, 18, 4, 12, 26, 4
canonical OTP: 008J4CT4
display OTP:   008J-4CT4
```

The parser accepts exactly two syntactic forms from user input:

```text
XXXXXXXX
XXXX-XXXX
```

ASCII uppercase and lowercase equivalents of letters in the alphabet are
accepted. Accepted lowercase letters are normalized to uppercase. The canonical
result is always exactly eight uppercase ASCII symbols without a hyphen.

The parser performs no ambiguous-character substitution. `O`/`o`, `I`/`i`,
`L`/`l`, and `U`/`u` are invalid because they are absent from the alphabet. In
particular, it must not map `O` to `0`, or `I` or `L` to `1`.

The parser rejects whitespace, tabs, newlines, leading or trailing whitespace,
Unicode characters, Unicode dash characters, wrong lengths, multiple hyphens,
invalid alphabet symbols, and all punctuation except the single ASCII hyphen at
position 5 of the display form.

## Challenge UUID bytes

The challenge identifier input must be a canonical hyphenated UUID textual form
with `8-4-4-4-12` hexadecimal digits. Hexadecimal digits may be uppercase or
lowercase. Remove the hyphens and decode the remaining 32 hexadecimal digits
left-to-right to exactly 16 bytes in RFC/textual/network byte order. Microsoft
GUID field-endian swapping is forbidden.

The frozen example is:

```text
00112233-4455-6677-8899-aabbccddeeff
-> 00 11 22 33 44 55 66 77 88 99 aa bb cc dd ee ff
```

## OTP HMAC

The algorithm is HMAC-SHA256 with the selected OTP key. Purpose is restricted to
the exact lowercase ASCII strings `enrollment` and `login`. The OTP is first
normalized to its canonical eight-character uppercase form.

The message bytes are exactly:

```text
UTF8("wincrm/every8d/settings/otp/v1")
|| 0x00
|| UTF8(purpose)
|| 0x00
|| UUID_BYTES_16
|| 0x00
|| ASCII(normalized_otp)
```

There is no trailing NUL, JSON serialization, or length prefix. The UUID field
is fixed at 16 bytes and the OTP field is fixed at 8 bytes. The output is exactly
32 HMAC bytes. `otp_hmac_key_version` is stored separately and is not included
in the HMAC message.

### Public fixed vectors

These vectors are public test data and are never production keys.

```text
key version:       otp-v1
key Base64URL:     ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8
challenge UUID:    00112233-4455-6677-8899-aabbccddeeff
display input:     0123-4567
canonical OTP:     01234567

purpose login:
1ae747b37e3bef979980cb106e880da4a3f88e61aa1409c4f50290f70d29ecfe

purpose enrollment:
e34767afbcde553162adbb76925dc0f7426422474d8d4b4bd2b557c806240dd6
```

The unequal login and enrollment results are the frozen purpose-separation
proof. A different challenge UUID necessarily changes the framed message and is
the challenge-separation boundary.

## Key selection and rotation

For new work, email pseudonyms use the active email-pseudonym version and OTP
HMACs use the active OTP version. A new challenge stores the exact OTP key
version used in `otp_hmac_key_version`.

Verification of an existing challenge selects the OTP key by that challenge's
stored version and fails closed if the version is unavailable. C3b-3 may
reconstruct historical email identity aliases by deriving candidates for every
configured email-pseudonym key version. Exact alias orchestration, ordering, and
locking remain C3b-3 scope; C3b-2 provides only deterministic primitives and
strict keyring access.

## Secret and activation safety

Implementations must not log raw request capabilities, OTPs, HMAC keys, derived
OTP HMACs, normalized identities, provider credentials, or OAuth tokens. No key
material is persisted or generated by these primitives. This contract does not
authorize live activation, production keys, routes, database writes, sessions,
administrators, email delivery, SMS, EVERY8D calls, or LINE changes.

Configuration parsing and validation errors must not contain raw environment
variable values, raw JSON keyring text, encoded HMAC keys, decoded or partial
key bytes, HMAC output derived from supplied keys, raw OTPs, or request
capabilities. Malformed secret input must never be embedded in an exception
message. The generic public- and server-log-safe error message is exactly:

```text
EVERY8D settings auth configuration is incomplete or invalid
```

An implementation may use a dedicated error class or type. Internal code may
also use non-secret category values such as `invalid_feature_flag`,
`incomplete_hmac_configuration`, `invalid_keyring`, or
`invalid_active_key_version`, but categories are optional and must not contain
or reproduce secret values. The dedicated error's default message must remain
the exact generic message above.
