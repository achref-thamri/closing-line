import type { UserFromGetMe } from "grammy/types";
import type { Reply } from "../app/chat.ts";

/** Chat ids for the owner and an approved bettor in the flow tests. */
export const OWNER = 100;
export const FRIEND = 200;

/** A bot account for grammY, so tests run without asking Telegram who the bot is. */
export const botInfo: UserFromGetMe = {
    id: 1,
    is_bot: true,
    first_name: "Closing Line",
    username: "closing_line_test_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
};

/** The callback data of the first button whose label contains `label`. */
export function button(reply: Reply | undefined, label: string): string {
    const found = reply?.keyboard?.flat().find((candidate) => candidate.text.includes(label));
    if (!found) throw new Error(`no ${label} button in ${JSON.stringify(reply)}`);
    return found.data;
}
