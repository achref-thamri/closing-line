import type { Player } from "@betting/db";

/** One colour per player, used by the cards, the chart and the table alike. */
export function playerColour(player: Pick<Player, "kind">): string {
    if (player.kind === "scanner") return "var(--color-scanner)";
    if (player.kind === "benchmark") return "var(--color-favourite)";
    return "var(--color-human)";
}

export const KIND_LABEL: Record<Player["kind"], string> = {
    scanner: "Scanner",
    benchmark: "Benchmark",
    human: "Human",
    shadow: "Shadow",
};
