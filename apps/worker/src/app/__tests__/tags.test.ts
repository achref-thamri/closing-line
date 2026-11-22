import { describe, expect, it } from "vitest";
import { isTagKey } from "../tags.ts";

describe("isTagKey", () => {
    it("knows the tag keys and nothing an object inherits", () => {
        expect(isTagKey("l")).toBe(true);
        expect(isTagKey("constructor")).toBe(false);
        expect(isTagKey("toString")).toBe(false);
    });
});
