/** An error answered in the Bot API envelope: `{ ok: false, error_code, description, parameters? }`. */
export class TgApiError extends Error {
  readonly errorCode: number;
  readonly description: string;
  readonly parameters?: { retry_after?: number };

  constructor(errorCode: number, description: string, parameters?: { retry_after?: number }) {
    super(description);
    this.name = 'TgApiError';
    this.errorCode = errorCode;
    this.description = description;
    this.parameters = parameters;
  }

  toEnvelope(): { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } } {
    return {
      ok: false,
      error_code: this.errorCode,
      description: this.description,
      ...(this.parameters ? { parameters: this.parameters } : {}),
    };
  }
}

export function badRequest(description: string): TgApiError {
  return new TgApiError(400, `Bad Request: ${description}`);
}

export function tooManyRequests(retryAfter: number): TgApiError {
  return new TgApiError(429, `Too Many Requests: retry after ${retryAfter}`, { retry_after: retryAfter });
}

/** An error of the control API (plain JSON `{ error }` with an HTTP status). */
export class ControlError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ControlError';
    this.statusCode = statusCode;
  }
}
