/** Why a bettor took a bet: the button key in Telegram, the stored tag and its label. */
export const TAGS = {
    l: { tag: "lineup", label: "⚡ Lineup" },
    s: { tag: "skewed_price", label: "📈 Skewed price" },
    g: { tag: "game_read", label: "🧠 Game read" },
    v: { tag: "slow_live_price", label: "⏱ Slow live price" },
    p: { tag: "value_tip", label: "🔎 Value tip" },
} as const;
export type TagKey = keyof typeof TAGS;
export const isTagKey = (value: string): value is TagKey => value in TAGS;
