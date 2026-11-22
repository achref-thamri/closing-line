/** Kroner as whole øre, the unit money is stored and summed in, so totals add up exactly. */
export function toOre(kroner: number): number {
    return Math.round(kroner * 100);
}
