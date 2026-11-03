/** The dashboard URL for a page of bets, optionally for one player; page 1 and "everyone" stay out of the URL. */
export function betsHref({ page = 1, player }: { page?: number; player?: string | undefined }): string {
    const params = new URLSearchParams();
    if (player) params.set("player", player);
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `/?${query}#bets` : "/#bets";
}
