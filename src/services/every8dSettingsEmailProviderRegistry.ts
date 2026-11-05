import type { Every8dSettingsEmailProvider } from "../types/every8dSettingsEmailProvider";

/** A later approved adapter owns its configuration validation and readiness checks.
 * Parsing must not send, retry, poll, or submit background/health-test messages.
 * Client construction stays lazy and must also perform none of those operations.
 * This slice calls neither method and supplies no production implementation.
 */
export type Every8dSettingsEmailProviderRegistration = Readonly<{
  parseReadiness(source: NodeJS.ProcessEnv): Readonly<{
    createClient(): Every8dSettingsEmailProvider;
  }>;
}>;

export type Every8dSettingsEmailProviderRegistry = Readonly<
  Record<string, Every8dSettingsEmailProviderRegistration>
>;

/** No provider is approved. Test registrations require explicit dependency injection. */
export const every8dSettingsEmailProviderRegistry: Every8dSettingsEmailProviderRegistry =
  Object.freeze({});

/** Exact own-property lookup only; no environment-selected code or construction. */
export function lookupEvery8dSettingsEmailProvider(
  providerId: string,
  registry: Every8dSettingsEmailProviderRegistry = every8dSettingsEmailProviderRegistry
): Every8dSettingsEmailProviderRegistration | undefined {
  return Object.hasOwn(registry, providerId) ? registry[providerId] : undefined;
}
