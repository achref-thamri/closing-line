import type { Player } from "@closing-line/db";
import Link from "next/link";
import { betsHref } from "../lib/links.ts";
import { playerColour } from "./players.ts";

const CHIP = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 whitespace-nowrap";
const ACTIVE = "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900";
const IDLE =
    "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900";

/** One link per player, plus "Everyone"; picking one starts again at page 1. */
export function PlayerFilter({ players, selected }: { players: Player[]; selected: string | undefined }) {
    return (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Show bets of">
            <Link
                className={`${CHIP} ${selected ? IDLE : ACTIVE}`}
                href={betsHref({})}
                aria-current={selected ? undefined : "page"}
            >
                Everyone
            </Link>
            {players.map((player) => (
                <Link
                    key={player.id}
                    className={`${CHIP} ${player.id === selected ? ACTIVE : IDLE}`}
                    href={betsHref({ player: player.id })}
                    aria-current={player.id === selected ? "page" : undefined}
                >
                    <span className="inline-block size-2 rounded-full" style={{ background: playerColour(player) }} />
                    {player.name}
                </Link>
            ))}
        </nav>
    );
}
