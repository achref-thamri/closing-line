import type { z } from "zod";
import { HttpError, messageOf, PermanentError, TransientError } from "./errors.ts";

export type Fetch = typeof fetch;

export interface GetJsonRequest<S extends z.ZodType> {
    url: URL;
    headers?: Record<string, string>;
    schema: S;
    timeoutMs?: number;
    fetch?: Fetch;
    /** Used in error messages instead of the URL, which may carry an API key. */
    label: string;
}

export interface JsonResponse<T> {
    data: T;
    headers: Headers;
}

/**
 * One GET with a JSON response validated by `schema`.
 * - Network errors, timeouts, 429 and 5xx throw TransientError (429 carries Retry-After as the minimum wait).
 * - Other non-2xx throw HttpError; an unexpected response shape throws PermanentError.
 */
export async function getJson<S extends z.ZodType>(request: GetJsonRequest<S>): Promise<JsonResponse<z.output<S>>> {
    const { url, headers = {}, schema, timeoutMs = 15_000, label } = request;
    const doFetch = request.fetch ?? fetch;
    let response: Response;
    try {
        response = await doFetch(url, {
            headers: { accept: "application/json", ...headers },
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        throw new TransientError(`${label}: ${messageOf(error)}`, undefined, { cause: error });
    }

    const text = await response.text();
    if (response.status === 429) {
        throw new TransientError(`${label}: rate limited (429)`, retryAfterMs(response.headers.get("retry-after")));
    }
    if (response.status >= 500) throw new TransientError(`${label}: server error ${response.status}`);
    if (!response.ok) throw new HttpError(`${label}: ${response.status} ${errorMessage(text)}`, response.status, text);

    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        throw new PermanentError(`${label}: response is not JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new PermanentError(
            `${label}: unexpected response (${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""})`,
        );
    }
    return { data: parsed.data, headers: response.headers };
}

function retryAfterMs(header: string | null): number | undefined {
    const seconds = Number(header);
    return header !== null && header !== "" && Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/** Vendors return `{"message": "..."}` or `{"error": "..."}`; fall back to the start of the text. */
function errorMessage(text: string): string {
    try {
        const json = JSON.parse(text) as Record<string, unknown>;
        const message = json.message ?? json.error;
        if (typeof message === "string") return message;
    } catch {
        // not JSON
    }
    return text.slice(0, 200);
}
