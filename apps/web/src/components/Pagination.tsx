import Link from "next/link";
import { betsHref } from "../lib/links.ts";

const LINK =
    "rounded-md border border-zinc-200 px-2.5 py-1 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900";
const DISABLED = "rounded-md border border-zinc-100 px-2.5 py-1 text-zinc-300 dark:border-zinc-900 dark:text-zinc-700";

/** Previous and next links around "Page x of y"; page 1 starts with the open bets that kick off soonest. */
export function Pagination({ page, pages, player }: { page: number; pages: number; player: string | undefined }) {
    if (pages <= 1) return null;
    return (
        <nav className="flex items-center justify-end gap-2 text-sm" aria-label="Bet pages">
            {page > 1 ? (
                <Link className={LINK} href={betsHref({ page: page - 1, player })} rel="prev">
                    ← Previous
                </Link>
            ) : (
                <span className={DISABLED}>← Previous</span>
            )}
            <span className="px-1 text-zinc-500 tabular-nums">
                Page {page} of {pages}
            </span>
            {page < pages ? (
                <Link className={LINK} href={betsHref({ page: page + 1, player })} rel="next">
                    Next →
                </Link>
            ) : (
                <span className={DISABLED}>Next →</span>
            )}
        </nav>
    );
}
