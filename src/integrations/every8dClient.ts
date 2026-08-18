import crypto from "node:crypto";

export type Every8dOperation =
  | "authenticate"
  | "send_sms"
  | "get_delivery_status"
  | "get_reply_messages";

export interface Every8dHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface Every8dHttpResponse {
  status: number;
  body: string;
}

export interface Every8dTransport {
  request(request: Every8dHttpRequest): Promise<Every8dHttpResponse>;
}

export interface Every8dLogger {
  info(metadata: Record<string, unknown>, message: string): void;
  warn(metadata: Record<string, unknown>, message: string): void;
  error(metadata: Record<string, unknown>, message: string): void;
}

export interface Every8dClientConfig {
  siteUrl: string;
  uid: string;
  password: string;
  timeoutMs: number;
}

export interface Every8dAuthenticationResult {
  token: string;
  httpStatus: number;
  durationMs: number;
}

export interface Every8dSendSmsInput {
  token: string;
  recipient: string;
  message: string;
  eventId?: string;
}

export interface Every8dSendSmsResult {
  credit: string;
  sentCount: number;
  cost: string;
  unsentCount: number;
  batchId: string;
  httpStatus: number;
  durationMs: number;
}

export interface Every8dDeliveryRecord {
  mr?: string;
  name?: string;
  mobile?: string;
  sendTime?: string;
  cost?: string;
  status?: string;
  realCost?: string;
  receivedTime?: string;
  description?: string;
}

export interface Every8dDeliveryStatusResult {
  smsCount: number;
  bid: string;
  records: Every8dDeliveryRecord[];
  httpStatus: number;
  durationMs: number;
}

export interface Every8dReplyRecord {
  name?: string;
  mobile?: string;
  content?: string;
  receivedTime?: string;
}

export interface Every8dReplyMessagesResult {
  smsCount: number;
  bid: string;
  records: Every8dReplyRecord[];
  httpStatus: number;
  durationMs: number;
}

export type Every8dClientErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "http_failure"
  | "provider_failure"
  | "malformed_response"
  | "timeout"
  | "network_failure";

export class Every8dClientError extends Error {
  readonly code: Every8dClientErrorCode;
  readonly operation: Every8dOperation;
  readonly httpStatus?: number;
  readonly providerStatus?: string;

  constructor(input: {
    code: Every8dClientErrorCode;
    operation: Every8dOperation;
    message: string;
    httpStatus?: number;
    providerStatus?: string;
  }) {
    super(input.message);
    this.name = "Every8dClientError";
    this.code = input.code;
    this.operation = input.operation;
    this.httpStatus = input.httpStatus;
    this.providerStatus = input.providerStatus;
  }
}

export class Every8dTransportError extends Error {
  readonly kind: "timeout" | "network_failure";

  constructor(kind: "timeout" | "network_failure") {
    super(kind === "timeout" ? "EVERY8D request timed out" : "EVERY8D network request failed");
    this.name = "Every8dTransportError";
    this.kind = kind;
  }
}

const sensitiveLogKeyPattern =
  /(authorization|bearer|token|password|pwd|uid|credential|secret|recipient|destination|dest|mobile|message|msg)/i;

const sensitiveTextPatterns: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, replacement: "$1[redacted]" },
  {
    pattern: /("(?:Authorization|Token|PWD|Password|UID|DEST|MOBILE|MSG|Msg)"\s*:\s*")[^"]*(")/gi,
    replacement: "$1[redacted]$2"
  },
  {
    pattern: /((?:Authorization|Token|PWD|Password|UID|DEST|MOBILE|MSG|Msg)=)[^&\s]+/gi,
    replacement: "$1[redacted]"
  }
] as const;

function sanitizeText(value: string): string {
  return sensitiveTextPatterns.reduce(
    (redacted, { pattern, replacement }) => redacted.replace(pattern, replacement),
    value
  );
}

export function sanitizeEvery8dLogMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEvery8dLogMetadata(item));
  }

  if (typeof value === "string") {
    return sanitizeText(value);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sensitiveLogKeyPattern.test(key) ? "[redacted]" : sanitizeEvery8dLogMetadata(entry)
    ])
  );
}

export function createSanitizedEvery8dLogger(logger: Every8dLogger): Every8dLogger {
  const sanitize = (metadata: Record<string, unknown>): Record<string, unknown> =>
    sanitizeEvery8dLogMetadata(metadata) as Record<string, unknown>;

  return {
    info: (metadata, message) => logger.info(sanitize(metadata), sanitizeText(message)),
    warn: (metadata, message) => logger.warn(sanitize(metadata), sanitizeText(message)),
    error: (metadata, message) => logger.error(sanitize(metadata), sanitizeText(message))
  };
}

export function createEvery8dFetchTransport(fetchImplementation: typeof fetch = globalThis.fetch): Every8dTransport {
  return {
    async request(request): Promise<Every8dHttpResponse> {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, request.timeoutMs);

      try {
        const response = await fetchImplementation(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: controller.signal
        });

        return {
          status: response.status,
          body: await response.text()
        };
      } catch {
        throw new Every8dTransportError(timedOut ? "timeout" : "network_failure");
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function buildReference(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function requireNonEmpty(value: string, key: string, operation: Every8dOperation): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Every8dClientError({
      code: "invalid_request",
      operation,
      message: `${key} is required`
    });
  }

  return normalized;
}

function requireConfigurationValue(value: string, key: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Every8dClientError({
      code: "invalid_configuration",
      operation: "authenticate",
      message: `${key} is required`
    });
  }

  return normalized;
}

function normalizeSiteUrl(siteUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Every8dClientError({
      code: "invalid_configuration",
      operation: "authenticate",
      message: "EVERY8D_SITE_URL must be a valid HTTPS origin"
    });
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Every8dClientError({
      code: "invalid_configuration",
      operation: "authenticate",
      message: "EVERY8D_SITE_URL must be a credential-free HTTPS origin"
    });
  }

  return parsed.origin;
}

function parseJsonObject(body: string, operation: Every8dOperation): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Every8dClientError({
      code: "malformed_response",
      operation,
      message: `EVERY8D ${operation} response was not valid JSON`
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Every8dClientError({
      code: "malformed_response",
      operation,
      message: `EVERY8D ${operation} response was not an object`
    });
  }

  return parsed as Record<string, unknown>;
}

function toProviderStatus(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function parseNonNegativeInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Every8dClientError({
      code: "malformed_response",
      operation: "send_sms",
      message: `EVERY8D SendSMS ${field} was invalid`
    });
  }

  return Number(value);
}

function deliveryString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function parseDeliveryCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return undefined;
}

function isSuccessfulHttpStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export class Every8dClient {
  private readonly siteUrl: string;
  private readonly uid: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly transport: Every8dTransport;
  private readonly logger: Every8dLogger;

  constructor(config: Every8dClientConfig, transport: Every8dTransport, logger: Every8dLogger) {
    this.siteUrl = normalizeSiteUrl(config.siteUrl);
    this.uid = requireConfigurationValue(config.uid, "EVERY8D_UID");
    this.password = requireConfigurationValue(config.password, "EVERY8D_PASSWORD");

    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 60_000) {
      throw new Every8dClientError({
        code: "invalid_configuration",
        operation: "authenticate",
        message: "EVERY8D_TIMEOUT_MS must be between 100 and 60000"
      });
    }

    this.timeoutMs = config.timeoutMs;
    this.transport = transport;
    this.logger = createSanitizedEvery8dLogger(logger);
  }

  async authenticate(): Promise<Every8dAuthenticationResult> {
    const operation: Every8dOperation = "authenticate";
    const startedAt = Date.now();
    this.logger.info({ operation }, "EVERY8D operation started");

    const response = await this.execute(operation, {
      url: `${this.siteUrl}/API21/HTTP/ConnectionHandler.ashx`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ HandlerType: 3, VerifyType: 1, UID: this.uid, PWD: this.password }),
      timeoutMs: this.timeoutMs
    });
    const durationMs = Date.now() - startedAt;
    const payload = parseJsonObject(response.body, operation);

    if (payload.Result === false) {
      const error = new Every8dClientError({
        code: "provider_failure",
        operation,
        httpStatus: response.status,
        providerStatus: toProviderStatus(payload.Status),
        message: "EVERY8D authentication was rejected"
      });
      this.logFailure(error, durationMs);
      throw error;
    }

    if (payload.Result !== true || typeof payload.Msg !== "string" || !payload.Msg.trim()) {
      const error = new Every8dClientError({
        code: "malformed_response",
        operation,
        httpStatus: response.status,
        message: "EVERY8D authentication response did not contain a token"
      });
      this.logFailure(error, durationMs);
      throw error;
    }

    this.logger.info(
      { operation, httpStatus: response.status, providerResult: true, durationMs, tokenAcquired: true },
      "EVERY8D operation completed"
    );

    return { token: payload.Msg, httpStatus: response.status, durationMs };
  }

  async sendSms(input: Every8dSendSmsInput): Promise<Every8dSendSmsResult> {
    const operation: Every8dOperation = "send_sms";
    const token = requireNonEmpty(input.token, "token", operation);
    const recipient = requireNonEmpty(input.recipient, "recipient", operation);
    const message = requireNonEmpty(input.message, "message", operation);
    const eventId =
      input.eventId === undefined ? undefined : requireNonEmpty(input.eventId, "eventId", operation);

    if (/[,;\r\n]/.test(recipient)) {
      throw new Every8dClientError({
        code: "invalid_request",
        operation,
        message: "EVERY8D controlled spike accepts exactly one recipient"
      });
    }

    if (Array.from(message).length > 333) {
      throw new Every8dClientError({
        code: "invalid_request",
        operation,
        message: "EVERY8D message exceeds the documented 333-character limit"
      });
    }

    const startedAt = Date.now();
    this.logger.info(
      {
        operation,
        recipientRef: buildReference(recipient),
        contentLength: Array.from(message).length,
        interactiveReplyRequested: eventId !== undefined,
        eventId
      },
      "EVERY8D operation started"
    );

    const parameters = new URLSearchParams({ MSG: message, DEST: recipient });

    if (eventId !== undefined) {
      parameters.set("EventID", eventId);
    }

    const body = parameters.toString();
    const response = await this.execute(operation, {
      url: `${this.siteUrl}/API21/HTTP/SendSMS.ashx`,
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body,
      timeoutMs: this.timeoutMs
    });
    const durationMs = Date.now() - startedAt;
    const parts = response.body.trim().split(",").map((part) => part.trim());

    if (parts.length === 2) {
      const error = new Every8dClientError({
        code: "provider_failure",
        operation,
        httpStatus: response.status,
        providerStatus: parts[0] || undefined,
        message: "EVERY8D SendSMS was rejected"
      });
      this.logFailure(error, durationMs);
      throw error;
    }

    if (parts.length !== 5 || parts.some((part) => part.length === 0)) {
      const error = new Every8dClientError({
        code: "malformed_response",
        operation,
        httpStatus: response.status,
        message: "EVERY8D SendSMS response did not match the documented five-field shape"
      });
      this.logFailure(error, durationMs);
      throw error;
    }

    const result: Every8dSendSmsResult = {
      credit: parts[0],
      sentCount: parseNonNegativeInteger(parts[1], "SENDED"),
      cost: parts[2],
      unsentCount: parseNonNegativeInteger(parts[3], "UNSEND"),
      batchId: parts[4],
      httpStatus: response.status,
      durationMs
    };

    this.logger.info(
      {
        operation,
        httpStatus: response.status,
        providerResult: true,
        sentCount: result.sentCount,
        unsentCount: result.unsentCount,
        batchId: result.batchId,
        durationMs
      },
      "EVERY8D operation completed"
    );

    return result;
  }

  async getDeliveryStatus(tokenValue: string, batchIdValue: string): Promise<Every8dDeliveryStatusResult> {
    const operation: Every8dOperation = "get_delivery_status";
    const token = requireNonEmpty(tokenValue, "token", operation);
    const batchId = requireNonEmpty(batchIdValue, "batchId", operation);
    const startedAt = Date.now();
    this.logger.info({ operation, batchId }, "EVERY8D operation started");

    const body = new URLSearchParams({ BID: batchId, PNO: "1", RESPFORMAT: "1" }).toString();
    const response = await this.execute(operation, {
      url: `${this.siteUrl}/API21/HTTP/GetDeliveryStatus.ashx`,
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body,
      timeoutMs: this.timeoutMs
    });
    const durationMs = Date.now() - startedAt;
    const payload = parseJsonObject(response.body, operation);
    const smsCount = parseDeliveryCount(payload.SMS_COUNT);
    const bid = deliveryString(payload, "BID");

    if (smsCount === undefined || !bid) {
      const error = new Every8dClientError({
        code: "malformed_response",
        operation,
        httpStatus: response.status,
        message: "EVERY8D delivery response omitted SMS_COUNT or BID"
      });
      this.logFailure(error, durationMs);
      throw error;
    }

    const rawRecords = payload.DATA === undefined && smsCount === 0 ? [] : payload.DATA;

    if (!Array.isArray(rawRecords) || rawRecords.some((record) => !record || typeof record !== "object" || Array.isArray(record))) {
      const error = new Every8dClientError({
        code: "malformed_response",
        operation,
        httpStatus: response.status,
        message: "EVERY8D delivery response DATA was invalid"
      });
      this.logFailure(error, durationMs);
      throw error;
    }

    const records = rawRecords.map((rawRecord) => {
      const record = rawRecord as Record<string, unknown>;
      return {
        mr: deliveryString(record, "MR"),
        name: deliveryString(record, "NAME"),
        mobile: deliveryString(record, "MOBILE"),
        sendTime: deliveryString(record, "SEND_TIME"),
        cost: deliveryString(record, "COST"),
        status: deliveryString(record, "STATUS"),
        realCost: deliveryString(record, "REAL_COST"),
        receivedTime: deliveryString(record, "RECEIVED_TIME"),
        description: deliveryString(record, "DESCRIPTION")
      } satisfies Every8dDeliveryRecord;
    });

    const result: Every8dDeliveryStatusResult = {
      smsCount,
      bid,
      records,
      httpStatus: response.status,
      durationMs
    };

    this.logger.info(
      {
        operation,
        httpStatus: response.status,
        providerResult: true,
        bid,
        smsCount,
        mrValues: records.map((record) => record.mr).filter(Boolean),
        deliveryStates: records.map((record) => record.status).filter(Boolean),
        durationMs
      },
      "EVERY8D operation completed"
    );

    return result;
  }

  async getReplyMessages(
    tokenValue: string,
    batchIdValue: string,
    pageNumber = 1
  ): Promise<Every8dReplyMessagesResult> {
    const operation: Every8dOperation = "get_reply_messages";
    const token = requireNonEmpty(tokenValue, "token", operation);
    const batchId = requireNonEmpty(batchIdValue, "batchId", operation);

    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      throw new Every8dClientError({
        code: "invalid_request",
        operation,
        message: "EVERY8D reply page number must be a positive integer"
      });
    }

    const startedAt = Date.now();
    this.logger.info({ operation, batchId, pageNumber }, "EVERY8D operation started");

    const body = new URLSearchParams({
      BID: batchId,
      PNO: String(pageNumber),
      RESPFORMAT: "1"
    }).toString();
    const response = await this.execute(operation, {
      url: `${this.siteUrl}/API21/HTTP/GetReplyMessage.ashx`,
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body,
      timeoutMs: this.timeoutMs
    });
    const durationMs = Date.now() - startedAt;
    const payload = parseJsonObject(response.body, operation);
    const smsCount = parseDeliveryCount(payload.SMS_COUNT);
    const bid = deliveryString(payload, "BID");

    if (smsCount === undefined || !bid) {
      const error = new Every8dClientError({
        code: "malformed_response",
        operation,
        httpStatus: response.status,
        message: "EVERY8D reply response omitted SMS_COUNT or BID"
      });
      this.logFailure(error, durationMs);
      throw error;
    }

    const rawRecords = payload.DATA === undefined && smsCount === 0 ? [] : payload.DATA;

    if (
      !Array.isArray(rawRecords) ||
      rawRecords.some((record) => !record || typeof record !== "object" || Array.isArray(record))
    ) {
      const error = new Every8dClientError({
        code: "malformed_response",
        operation,
        httpStatus: response.status,
        message: "EVERY8D reply response DATA was invalid"
      });
      this.logFailure(error, durationMs);
      throw error;
    }

    const records = rawRecords.map((rawRecord) => {
      const record = rawRecord as Record<string, unknown>;
      return {
        name: deliveryString(record, "NAME"),
        mobile: deliveryString(record, "MOBILE"),
        content: deliveryString(record, "CONTENT"),
        receivedTime: deliveryString(record, "RECEIVED_TIME")
      } satisfies Every8dReplyRecord;
    });

    const result: Every8dReplyMessagesResult = {
      smsCount,
      bid,
      records,
      httpStatus: response.status,
      durationMs
    };

    this.logger.info(
      {
        operation,
        httpStatus: response.status,
        providerResult: true,
        bid,
        smsCount,
        pageNumber,
        durationMs
      },
      "EVERY8D operation completed"
    );

    return result;
  }

  private async execute(operation: Every8dOperation, request: Every8dHttpRequest): Promise<Every8dHttpResponse> {
    let response: Every8dHttpResponse;

    try {
      response = await this.transport.request(request);
    } catch (error) {
      const clientError = new Every8dClientError({
        code: error instanceof Every8dTransportError ? error.kind : "network_failure",
        operation,
        message:
          error instanceof Every8dTransportError && error.kind === "timeout"
            ? `EVERY8D ${operation} timed out`
            : `EVERY8D ${operation} network request failed`
      });
      this.logFailure(clientError);
      throw clientError;
    }

    if (!isSuccessfulHttpStatus(response.status)) {
      const error = new Every8dClientError({
        code: "http_failure",
        operation,
        httpStatus: response.status,
        message: `EVERY8D ${operation} returned an unsuccessful HTTP status`
      });
      this.logFailure(error);
      throw error;
    }

    return response;
  }

  private logFailure(error: Every8dClientError, durationMs?: number): void {
    this.logger.error(
      {
        operation: error.operation,
        errorCode: error.code,
        httpStatus: error.httpStatus,
        providerStatus: error.providerStatus,
        durationMs
      },
      "EVERY8D operation failed"
    );
  }
}
