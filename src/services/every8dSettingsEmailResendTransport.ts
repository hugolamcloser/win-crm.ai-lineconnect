import { addAbortListener } from "node:events";
import { connect as connectTcp, type Socket, type TcpNetConnectOpts } from "node:net";
import { connect as connectTls, rootCertificates, type ConnectionOptions, type TLSSocket } from "node:tls";

export const resendHost = "api.resend.com";
export const resendMinimumBudgetNs = 1_000_000n;
const maxHeaders = 16_384;
const maxStatusLine = 1024;
const maxBody = 16_384;
const maxChunkMetadata = 128 * 1024;

export type ResendSocketConnectors = Readonly<{
  tcp(options: TcpNetConnectOpts): Socket;
  tls(options: ConnectionOptions): TLSSocket;
}>;

type ResponseObserver = Readonly<{
  status(status: number): void;
  headers(status: number): void;
  invalid(status: number): void;
  complete(status: number, body: Buffer): void;
}>;

const singletonHeaders = new Set([
  "content-type", "content-encoding", "content-length", "transfer-encoding", "trailer", "connection",
]);

// This parser consumes only a single explicitly framed HTTP/1.1 response.
class ResendResponse {
  private headerBytes = Buffer.alloc(maxHeaders);
  private body = Buffer.alloc(maxBody);
  private sizeLine = Buffer.alloc(18);
  private headerEnd = 0;
  private bodyEnd = 0;
  private sizeEnd = 0;
  private metadata = 0;
  private status = 0;
  private remaining = 0;
  private delimiterEnd = 0;
  private phase: "headers" | "fixed" | "size" | "chunk" | "chunkEnd" | "trailerEnd" | "done" = "headers";

  constructor(private readonly observer: ResponseObserver) {}

  dispose(): void {
    this.phase = "done";
    this.headerBytes.fill(0);
    this.body.fill(0);
    this.sizeLine.fill(0);
  }

  private invalid(): void {
    this.phase = "done";
    this.observer.invalid(this.status);
  }

  private complete(): void {
    this.phase = "done";
    this.observer.complete(this.status, this.body.subarray(0, this.bodyEnd));
  }

  private readHeaders(): void {
    const fields = this.headerBytes.toString("latin1", 0, this.headerEnd - 4).split("\r\n");
    const headers = new Map<string, string>();
    let duplicate = false;
    for (const field of fields.slice(1)) {
      const match = /^([\x60!#$%&'*+.^_|~0-9A-Za-z-]+):([\t\x20-\x7e\x80-\xff]*)$/.exec(field);
      if (!match || match[0].length !== field.length) { this.invalid(); return; }
      const name = match[1].toLowerCase();
      if (!singletonHeaders.has(name)) continue;
      if (headers.has(name)) duplicate = true;
      headers.set(name, match[2].replace(/^[ \t]+|(?<![ \t])[ \t]+$/g, ""));
    }

    this.observer.headers(this.status);
    if (this.stopped()) return;

    const media = headers.get("content-type") ?? "";
    const encoding = headers.get("content-encoding")?.toLowerCase();
    const connection = headers.get("connection")?.toLowerCase();
    const transfer = headers.get("transfer-encoding")?.toLowerCase();
    const length = headers.get("content-length");
    if (duplicate || headers.has("trailer") ||
        !/^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/i.test(media) ||
        (encoding !== undefined && encoding !== "identity") ||
        (connection !== undefined && connection !== "close" && connection !== "keep-alive") ||
        (transfer === undefined) === (length === undefined)) {
      this.invalid();
      return;
    }
    if (transfer === "chunked") {
      this.phase = "size";
    } else if (length !== undefined && length.length && !/[^0-9]/.test(length) && Number(length) <= maxBody) {
      this.remaining = Number(length);
      this.phase = "fixed";
      if (this.remaining === 0) this.complete();
    } else {
      this.invalid();
    }
  }

  private stopped(): boolean { return this.phase === "done"; }

  private headerByte(byte: number): void {
    this.headerBytes[this.headerEnd++] = byte;
    if (!this.status) {
      if (this.headerEnd > maxStatusLine) { this.invalid(); return; }
      if (byte === 10) {
        const line = this.headerBytes.toString("latin1", 0, this.headerEnd);
        const match = /^HTTP\/1\.1 ([1-5][0-9]{2}) [\x20-\x7e]*\r\n$/.exec(line);
        if (!match) { this.invalid(); return; }
        this.status = Number(match[1]);
        if (this.status < 200) { this.invalid(); return; }
        this.observer.status(this.status);
        if (this.stopped()) return;
      }
    }
    if (this.headerEnd >= 4 && this.headerBytes.readUInt32BE(this.headerEnd - 4) === 0x0d0a0d0a) {
      this.readHeaders();
    } else if (this.headerEnd === maxHeaders) {
      this.invalid();
    }
  }

  private chunkMetadata(byte: number): void {
    if (++this.metadata > maxChunkMetadata) { this.invalid(); return; }
    if (this.phase === "size") {
      if (this.sizeEnd === this.sizeLine.length) { this.invalid(); return; }
      this.sizeLine[this.sizeEnd++] = byte;
      if (byte !== 10) return;
      const line = this.sizeLine.toString("latin1", 0, this.sizeEnd);
      const match = /^([0-9a-fA-F]{1,16})\r\n$/.exec(line);
      if (!match) { this.invalid(); return; }
      const size = BigInt("0x" + match[1]);
      if (size > BigInt(maxBody - this.bodyEnd) || (size === 0n && match[1] !== "0")) { this.invalid(); return; }
      this.sizeEnd = 0;
      this.remaining = Number(size);
      this.phase = size === 0n ? "trailerEnd" : "chunk";
      return;
    }

    if (byte !== (this.delimiterEnd === 0 ? 13 : 10)) { this.invalid(); return; }
    if (++this.delimiterEnd < 2) return;
    this.delimiterEnd = 0;
    if (this.phase === "trailerEnd") this.complete();
    else this.phase = "size";
  }

  feed(data: Buffer): void {
    let index = 0;
    while (index < data.length && !this.stopped()) {
      if (this.phase === "headers") {
        this.headerByte(data[index++]);
      } else if (this.phase === "fixed" || this.phase === "chunk") {
        const size = Math.min(this.remaining, data.length - index);
        data.copy(this.body, this.bodyEnd, index, index + size);
        index += size;
        this.bodyEnd += size;
        this.remaining -= size;
        if (this.remaining !== 0) continue;
        if (this.phase === "fixed") this.complete();
        else this.phase = "chunkEnd";
      } else {
        this.chunkMetadata(data[index++]);
      }
    }
  }
}

// The callback is the sole remaining adapter reference after write entry. Its
// invocation proves the stream released this buffer, even on callback error.
function releaseOnWrite(buffer: Buffer | undefined, onError: () => void) {
  return (error?: Error | null) => {
    buffer?.fill(0);
    buffer = undefined;
    if (error) onError();
  };
}

type ResendExchange<Result> = Readonly<{
  signal: AbortSignal;
  deadline: bigint;
  notStarted: Result;
  unknown: Result;
  preEntryFailure(): void;
  onStatus(status: number): void;
  onHeaders(status: number): Result | undefined;
  onInvalid(status: number): Result;
  onBody(status: number, body: Buffer, expired: () => boolean): Result;
}>;

export function exchangeResendHttp<Result>(
  request: Buffer | undefined,
  exchange: ResendExchange<Result>,
  connectors: ResendSocketConnectors = { tcp: connectTcp, tls: connectTls },
): Promise<Result> {
  return new Promise((resolve) => {
    const { signal, deadline } = exchange;
    let entered = false;
    let settled = false;
    let tcp: Socket | undefined;
    let tls: TLSSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: ReturnType<typeof addAbortListener> | undefined;
    let response: ResendResponse | undefined;

    const finish = (result: Result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortListener?.[Symbol.dispose]();
      response?.dispose();
      response = undefined;
      request?.fill(0);
      request = undefined;
      tls?.destroy();
      tcp?.destroy();
      tls = undefined;
      tcp = undefined;
      resolve(result);
    };

    const fail = () => finish(entered ? exchange.unknown : exchange.notStarted);
    const expired = () => signal.aborted || process.hrtime.bigint() >= deadline;
    const armDeadline = () => {
      const remaining = deadline - process.hrtime.bigint();
      if (remaining <= 0n) { fail(); return; }
      const delay = (remaining + resendMinimumBudgetNs - 1n) / resendMinimumBudgetNs;
      timer = setTimeout(armDeadline, Number(delay > 2_147_483_647n ? 2_147_483_647n : delay));
    };

    const onSecure = () => {
      if (settled || !request || !tls) return;
      try {
        if (expired() || !tls.authorized || (tls.alpnProtocol && tls.alpnProtocol !== "http/1.1")) { fail(); return; }
        const submitted = request;
        // Transfer ownership before invoking write. A throw does not establish release.
        request = undefined;
        tls.write(submitted, releaseOnWrite(submitted, fail));
      } catch { fail(); }
    };

    const onConnect = () => {
      if (settled || !tcp) return;
      try {
        if (expired()) { fail(); return; }
        const secure = connectors.tls({
          socket: tcp, servername: resendHost, rejectUnauthorized: true,
          minVersion: "TLSv1.2", ALPNProtocols: ["http/1.1"], ca: [...rootCertificates],
        });
        secure.on("error", fail);
        if (settled) { secure.destroy(); return; }
        tls = secure;
        secure.once("end", fail);
        secure.once("close", fail);
        secure.on("data", (data: Buffer) => {
          if (settled) return;
          if (request !== undefined) { fail(); return; }
          if (expired()) { fail(); return; }
          try {
            if (!response) response = new ResendResponse({
              status(status) {
                if (!expired()) exchange.onStatus(status);
              },
              headers(status) {
                if (expired()) { fail(); return; }
                const result = exchange.onHeaders(status);
                if (result !== undefined) finish(result);
              },
              invalid(status) { finish(expired() ? exchange.unknown : exchange.onInvalid(status)); },
              complete(status, body) { finish(expired() ? exchange.unknown : exchange.onBody(status, body, expired)); },
            });
            response.feed(data);
          } catch { fail(); }
        });
        secure.once("secureConnect", onSecure);
      } catch { fail(); }
    };

    try {
      abortListener = addAbortListener(signal, fail);
      armDeadline();
      const options = { host: resendHost, port: 443, autoSelectFamily: false };
      if (settled || signal.aborted || deadline - process.hrtime.bigint() < resendMinimumBudgetNs) { fail(); return; }
      entered = true;
      const plain = connectors.tcp(options);
      plain.on("error", fail);
      if (settled) { plain.destroy(); return; }
      tcp = plain;
      plain.once("close", fail);
      plain.once("connect", onConnect);
    } catch {
      if (!entered) exchange.preEntryFailure();
      fail();
    }
  });
}
