import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError, TransientError } from "../errors.ts";
import { getJson, type Fetch } from "../http.ts";

const url = new URL("https://api.example.com/things?apiKey=secret");

function request(response: Response) {
    return getJson({
        url,
        schema: z.array(z.number()),
        label: "Example",
        fetch: vi.fn<Fetch>().mockResolvedValue(response),
    });
}

describe("getJson", () => {
    it("returns validated data with the headers", async () => {
        const { data, headers } = await request(new Response("[1,2]", { headers: { "x-count": "2" } }));
        expect(data).toEqual([1, 2]);
        expect(headers.get("x-count")).toBe("2");
    });

    it("carries Retry-After on 429", async () => {
        const error = await request(new Response("", { status: 429, headers: { "retry-after": "3" } })).catch(
            (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(TransientError);
        expect((error as TransientError).retryAfterMs).toBe(3_000);
        const noHeader = await request(new Response("", { status: 429 })).catch((caught: unknown) => caught);
        expect((noHeader as TransientError).retryAfterMs).toBeUndefined();
    });

    it("uses the vendor's message, or the start of the body", async () => {
        await expect(request(new Response('{"error":"nope"}', { status: 403 }))).rejects.toThrow("Example: 403 nope");
        await expect(request(new Response("plain text failure", { status: 400 }))).rejects.toThrow(
            "Example: 400 plain text failure",
        );
        await expect(request(new Response('{"code":7}', { status: 400 }))).rejects.toThrow(HttpError);
    });

    it("never puts the URL in errors", async () => {
        const failing = getJson({
            url,
            schema: z.unknown(),
            label: "Example",
            fetch: vi.fn<Fetch>().mockRejectedValue(new Error("connect ECONNREFUSED")),
        });
        await expect(failing).rejects.toThrow("Example: connect ECONNREFUSED");
        await expect(request(new Response("[1,2]"))).resolves.toBeDefined();
    });

    it("uses the global fetch by default", async () => {
        const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[3]"));
        expect((await getJson({ url, schema: z.array(z.number()), label: "Example" })).data).toEqual([3]);
        spy.mockRestore();
    });
});
