import type { Repositories } from "@closing-line/db";

/** A bet logged this long ago has usually finished; younger ones are left alone. */
const OPEN_FOR_MS = 12 * 3_600_000;

export interface RemindDeps {
    repos: Pick<Repositories, "players" | "bets">;
    send: (chatId: number, text: string) => Promise<void>;
    now: () => Date;
}

/** Nudges each bettor with bets logged over 12 hours ago and still open to settle them; returns how many were nudged. */
export async function remindOpenBets(deps: RemindDeps): Promise<number> {
    const cutoff = deps.now().getTime() - OPEN_FOR_MS;
    let reminded = 0;
    for (const player of await deps.repos.players.list()) {
        if (player.kind !== "bettor" || player.telegramChatId === null) continue;
        const due = (await deps.repos.bets.openFor(player.id)).filter((bet) => bet.createdAt.getTime() <= cutoff);
        if (due.length === 0) continue;
        const bets = due.length === 1 ? "1 open bet" : `${due.length} open bets`;
        await deps.send(
            Number(player.telegramChatId),
            `🔔 You have ${bets} from earlier. Send /open to mark them won, lost, void or cashed out.`,
        );
        reminded++;
    }
    return reminded;
}
