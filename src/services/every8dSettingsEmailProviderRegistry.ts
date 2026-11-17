import { parseEvery8dSettingsEmailResendApiKey } from "../config/every8dSettingsEmailResend";
import type { Every8dSettingsEmailProvider } from "../types/every8dSettingsEmailProvider";

/** Readiness and construction are local. The lifecycle callback carries no delivery evidence. */
export type Every8dSettingsEmailProviderRegistration = Readonly<{
  parseReadiness(source: NodeJS.ProcessEnv): Readonly<{
    createClient(reportProviderFatal: () => void): Every8dSettingsEmailProvider;
  }>;
}>;

export type Every8dSettingsEmailProviderRegistry = Readonly<
  Record<string, Every8dSettingsEmailProviderRegistration>
>;

/** Static source registration. Test registrations require explicit dependency injection. */
export const every8dSettingsEmailProviderRegistry: Every8dSettingsEmailProviderRegistry =
  Object.freeze({
    resend: Object.freeze({
      parseReadiness(source: NodeJS.ProcessEnv) {
        const apiKey = parseEvery8dSettingsEmailResendApiKey(source.EVERY8D_SETTINGS_AUTH_EMAIL_RESEND_API_KEY);
        if (apiKey === undefined) throw new Error("Invalid Resend email configuration.");
        return Object.freeze({
          createClient(reportProviderFatal: () => void) {
            if (typeof reportProviderFatal !== "function") throw new Error("Invalid Resend email configuration.");
            // Keep transport modules out of config admission and readiness.
            const { createEvery8dSettingsEmailResendProvider } = require("./every8dSettingsEmailResendProvider") as
              typeof import("./every8dSettingsEmailResendProvider");
            return createEvery8dSettingsEmailResendProvider({ apiKey, reportProviderFatal });
          }
        });
      }
    })
  });

/** Exact own-property lookup only; no environment-selected code or construction. */
export function lookupEvery8dSettingsEmailProvider(
  providerId: string,
  registry: Every8dSettingsEmailProviderRegistry = every8dSettingsEmailProviderRegistry
): Every8dSettingsEmailProviderRegistration | undefined {
  return Object.hasOwn(registry, providerId) ? registry[providerId] : undefined;
}
