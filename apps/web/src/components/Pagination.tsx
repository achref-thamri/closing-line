import Link from "next/link";
import { betsHref } from "../lib/links.ts";

const LINK =
    "rounded-md border border-zinc-200 px-2.5 py-1 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900";
const DISABLED = "rounded-md border border-zinc-100 px-2.5 py-1 text-zinc-300 dark:border-zinc-900 dark:text-zinc-700";

/** Newer and older links around "Page x of y"; the newest bets are on page 1. */
export function Pagination({ page, pages, player }: { page: number; pages: number; player: string | undefined }) {
    if (pages <= 1) return null;
    return (
        <nav className="flex items-center justify-end gap-2 text-sm" aria-label="Bet pages">
            {page > 1 ? (
                <Link className={LINK} href={betsHref({ page: page - 1, player })} rel="prev">
                    ← Newer
                </Link>
            ) : (
                <span className={DISABLED}>← Newer</span>
            )}
            <span className="px-1 text-zinc-500 tabular-nums">
                Page {page} of {pages}
            </span>
            {page < pages ? (
                <Link className={LINK} href={betsHref({ page: page + 1, player })} rel="next">
                    Older →
                </Link>
            ) : (
                <span className={DISABLED}>Older →</span>
            )}
        </nav>
    );
}
