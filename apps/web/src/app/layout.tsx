import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
    title: "Closing Line",
    description: "Paper-betting leaderboard: value scanner, benchmark and humans against the closing line",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body className="font-sans">{children}</body>
        </html>
    );
}
