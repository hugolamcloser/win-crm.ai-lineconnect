export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  statusCode?: number;
  responseBody?: string;
  requestPayload?: unknown;
  path?: string;
  method?: string;
  authMode?: string;
  canonicalCode?: string;
  publicErrorCode?: string;
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : JSON.stringify(error);
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const details = error as Error & {
      statusCode?: number;
      responseBody?: string;
      requestPayload?: unknown;
      path?: string;
      method?: string;
      authMode?: string;
      canonicalCode?: string;
      publicErrorCode?: string;
    };

    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      statusCode: details.statusCode,
      responseBody: details.responseBody,
      requestPayload: details.requestPayload,
      path: details.path,
      method: details.method,
      authMode: details.authMode,
      canonicalCode: details.canonicalCode,
      publicErrorCode: details.publicErrorCode
    };
  }

  return {
    name: "NonError",
    message: getErrorMessage(error)
  };
}
