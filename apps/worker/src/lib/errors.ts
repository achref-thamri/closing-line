/** The message of anything thrown; a thrown string or object is turned into text instead of logging undefined. */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** A failure worth retrying: timeouts, network errors, HTTP 429 and 5xx. */
export class TransientError extends Error {
    override name = "TransientError";
    /** Server-requested wait (e.g. Retry-After), used as the minimum delay before the next attempt. */
    readonly retryAfterMs: number | undefined;

    constructor(message: string, retryAfterMs?: number, options?: ErrorOptions) {
        super(message, options);
        this.retryAfterMs = retryAfterMs;
    }
}

/** A failure that will not go away by retrying: bad request, auth, validation. */
export class PermanentError extends Error {
    override name = "PermanentError";
}

/** A non-retryable HTTP response (4xx other than 429). */
export class HttpError extends PermanentError {
    override name = "HttpError";
    readonly status: number;
    /** Response body text, for vendor error messages. */
    readonly body: string;

    constructor(message: string, status: number, body: string) {
        super(message);
        this.status = status;
        this.body = body;
    }
}
