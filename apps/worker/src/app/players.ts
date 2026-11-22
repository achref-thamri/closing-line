import { toOre } from "@closing-line/core";
import type { Config } from "@closing-line/config";
import type { NewPlayer, Repositories } from "@closing-line/db";

export const SCANNER = "scanner";
export const FAVOURITE = "favourite";

/** Creates the automated players if missing. Bettors get their player when they first use the bot. */
export async function ensurePlayers(repos: Pick<Repositories, "players">, config: Pick<Config, "startingBankroll">) {
    const startingBankrollOre = toOre(config.startingBankroll);
    const players: NewPlayer[] = [
        { id: SCANNER, name: "Value scanner", kind: "scanner", startingBankrollOre },
        { id: FAVOURITE, name: "Always the favourite", kind: "benchmark", startingBankrollOre },
    ];
    await repos.players.ensure(players);
}
