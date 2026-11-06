import type { BetWithFixture } from "@closing-line/db";
import { describe, expect, it } from "vitest";
import { groupBets } from "../groups.ts";

// Friday 6 Nov 2026, 20:50 in Copenhagen.
const now = new Date("2026-11-06T19:50:00Z");

function bet(status: BetWithFixture["status"], kickoff: string | null, id: string): BetWithFixture {
    return {
        id,
        status,
        createdAt: new Date("2026-11-01T10:00:00Z"),
        receivedAt: kickoff === null ? new Date("2026-11-06T12:00:00Z") : null,
        fixture: kickoff === null ? null : { homeTeam: "A", awayTeam: "B", kickoff: new Date(kickoff), league: "x" },
    } as BetWithFixture;
}

const labels = (bets: BetWithFixture[]) =>
    groupBets(bets, now).map((group) => [group.label, group.bets.map((each) => each.id)]);

describe("groupBets", () => {
    it("heads open bets by kickoff day, then puts every settled bet under one heading", () => {
        expect(
            labels([
                bet("open", "2026-11-05T19:00:00Z", "yesterday"),
                bet("open", "2026-11-06T20:00:00Z", "tonight"),
                bet("open", null, "untracked"),
                bet("open", "2026-11-06T23:30:00Z", "after-midnight"),
                bet("open", "2026-11-21T15:00:00Z", "later"),
                bet("won", "2026-11-04T19:45:00Z", "won"),
                bet("lost", "2026-11-04T19:45:00Z", "lost"),
            ]),
        ).toEqual([
            ["Waiting for a result", ["yesterday"]],
            ["Today · Fri 6 Nov", ["tonight", "untracked"]],
            // 23:30 UTC is 00:30 in Copenhagen: tomorrow there.
            ["Tomorrow · Sat 7 Nov", ["after-midnight"]],
            ["Sat 21 Nov", ["later"]],
            ["Settled", ["won", "lost"]],
        ]);
    });

    it("has no groups without bets", () => {
        expect(groupBets([], now)).toEqual([]);
    });
});
