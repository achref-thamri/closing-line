import { describe, expect, it } from "vitest";
import { messageOf } from "../errors.ts";

describe("messageOf", () => {
    it("reads an error's message and turns anything else thrown into text", () => {
        expect(messageOf(new TypeError("fetch failed"))).toBe("fetch failed");
        expect(messageOf("timeout")).toBe("timeout");
        expect(messageOf(undefined)).toBe("undefined");
    });
});
