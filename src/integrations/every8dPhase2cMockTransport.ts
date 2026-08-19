import type {
  Every8dHttpRequest,
  Every8dHttpResponse,
} from "./every8dClient";
import {
  EVERY8D_MOCK_TRANSPORT_KIND,
  type Every8dMockOnlyTransport,
} from "./every8dSmsProvider";

export interface Every8dPhase2cMockTransport
  extends Every8dMockOnlyTransport {
  readonly requests: Every8dHttpRequest[];
}

export function createEvery8dPhase2cMockTransport(): Every8dPhase2cMockTransport {
  const requests: Every8dHttpRequest[] = [];

  return {
    kind: EVERY8D_MOCK_TRANSPORT_KIND,
    requests,
    async request(request): Promise<Every8dHttpResponse> {
      requests.push({
        ...request,
        headers: { ...request.headers },
      });

      if (/\/ConnectionHandler\.ashx$/.test(request.url)) {
        return {
          status: 200,
          body: JSON.stringify({
            Result: true,
            Msg: "phase-2c-mock-bearer",
          }),
        };
      }

      if (/\/SendSMS\.ashx$/.test(request.url)) {
        return {
          status: 200,
          body: "98,1,1,0,phase-2c-mock-batch",
        };
      }

      throw new Error("Unexpected Phase 2C mock EVERY8D operation");
    },
  };
}
