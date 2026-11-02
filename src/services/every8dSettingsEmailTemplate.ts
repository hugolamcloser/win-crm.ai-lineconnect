import { formatEvery8dSettingsOtp, parseEvery8dSettingsOtp } from "./every8dSettingsAuthPrimitives";
import type { Every8dSettingsAuthPurpose } from "./every8dSettingsAuthPrimitives";

/** Fixed security wording for v1; final product/brand copy is deliberately not frozen. */
export function renderEvery8dSettingsEmail(input: Readonly<{
  purpose: Every8dSettingsAuthPurpose; templateVersion: 1; displayOtp: string; deliveryDeadlineAt: string;
}>): Readonly<{ subject: string; body: string }> {
  try {
    if (input.templateVersion !== 1 || (input.purpose !== "enrollment" && input.purpose !== "login") ||
      typeof input.displayOtp !== "string" || formatEvery8dSettingsOtp(parseEvery8dSettingsOtp(input.displayOtp)) !== input.displayOtp) {
      throw new Error();
    }
    const deadline = Date.parse(input.deliveryDeadlineAt);
    if (!Number.isFinite(deadline)) throw new Error();
    // Round DOWN to whole seconds: wording never extends the durable deadline.
    const before = new Date(Math.floor(deadline / 1000) * 1000).toISOString();
    const action = input.purpose === "enrollment" ? "complete settings enrollment" : "sign in to settings";
    return Object.freeze({ subject: input.purpose === "enrollment" ? "Settings enrollment code" : "Settings sign-in code",
      body: `Use this code to ${action}: ${input.displayOtp}\n\nUse it before ${before} (UTC). It may expire earlier.\nIf you did not request this code, you can ignore this email.` });
  } catch { throw new Error("Settings email template unavailable"); }
}
