import type { Every8dSettingsAuthPurpose } from "../services/every8dSettingsAuthPrimitives";

export const every8dSettingsEmailDeliveryFailureClasses = Object.freeze([
  "provider_rejected",
  "delivery_outcome_unknown",
  "sender_unavailable"
] as const);

export type Every8dSettingsEmailDeliveryFailureClass =
  typeof every8dSettingsEmailDeliveryFailureClasses[number];

export type Every8dSettingsEmailDeliveryRequest = {
  recipient: string;
  purpose: Every8dSettingsAuthPurpose;
  displayOtp: string;
  expiresAt: Date;
};

export type Every8dSettingsEmailDeliveryResult =
  | { delivered: true }
  | { delivered: false; failureClass: Every8dSettingsEmailDeliveryFailureClass };

export interface Every8dSettingsEmailDelivery {
  deliverChallenge(
    request: Every8dSettingsEmailDeliveryRequest
  ): Promise<Every8dSettingsEmailDeliveryResult>;
}
