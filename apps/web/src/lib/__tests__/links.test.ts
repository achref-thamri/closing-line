import { describe, expect, it } from "vitest";
import { betsHref } from "../links.ts";

describe("betsHref", () => {
    it("leaves the first page and everyone out of the URL", () => {
        expect(betsHref({})).toBe("/#bets");
        expect(betsHref({ page: 1, player: undefined })).toBe("/#bets");
    });

    it("keeps the player when paging", () => {
        expect(betsHref({ page: 3 })).toBe("/?page=3#bets");
        expect(betsHref({ player: "scanner" })).toBe("/?player=scanner#bets");
        expect(betsHref({ page: 2, player: "scanner" })).toBe("/?player=scanner&page=2#bets");
    });
});
