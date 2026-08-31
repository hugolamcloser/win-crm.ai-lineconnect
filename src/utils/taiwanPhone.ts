export interface NormalizedTaiwanMobile {
  canonicalE164: string;
  every8dNational: string;
}

const TAIWAN_NATIONAL_MOBILE = /^09\d{8}$/;
const TAIWAN_E164_MOBILE = /^\+8869\d{8}$/;

export function normalizeTaiwanMobile(
  value: string,
): NormalizedTaiwanMobile | null {
  if (TAIWAN_NATIONAL_MOBILE.test(value)) {
    return {
      canonicalE164: `+886${value.slice(1)}`,
      every8dNational: value,
    };
  }

  if (TAIWAN_E164_MOBILE.test(value)) {
    return {
      canonicalE164: value,
      every8dNational: `0${value.slice(4)}`,
    };
  }

  return null;
}
