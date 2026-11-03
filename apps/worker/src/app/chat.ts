/** The shapes the Telegram flows answer with; the Telegram adapter turns them into messages. */

export interface Button {
    text: string;
    data: string;
}
/** Rows of inline buttons under a message. */
export type Keyboard = Button[][];

export interface Reply {
    text: string;
    keyboard?: Keyboard;
}

/** Sends new messages; the Telegram adapter implements it. */
export interface Messenger {
    send(chatId: number, reply: Reply): Promise<void>;
}

/** A flow that answers button taps. `owns` tells the adapter which taps are its own, by their data prefix. */
export interface ButtonHandler {
    owns(data: string): boolean;
    /** Returns the new text for the message the button was on. */
    tap(chatId: number, data: string): Promise<Reply>;
}

/** Whether button data such as `st:<bet>:w` starts with one of `actions`. */
export function hasAction(data: string, actions: readonly string[]): boolean {
    const separator = data.indexOf(":");
    return actions.includes(separator < 0 ? data : data.slice(0, separator));
}

/** Lays buttons out `size` to a row. */
export function rows(buttons: Button[], size: number): Keyboard {
    const result: Keyboard = [];
    for (let i = 0; i < buttons.length; i += size) result.push(buttons.slice(i, i + size));
    return result;
}
