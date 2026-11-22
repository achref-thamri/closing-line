import { describe, expect, it, vi, type Mock } from "vitest";
import { silentLogger, type Logger } from "../logger.ts";
import { createTextSender } from "../telegram.ts";

function spyLogger(): { logger: Logger; warn: Mock } {
    const warn = vi.fn();
    return { logger: { ...silentLogger, warn }, warn };
}

describe("createTextSender", () => {
    it("sends plain text without link previews", async () => {
        const sendMessage = vi.fn().mockResolvedValue({});
        await createTextSender({ api: { sendMessage }, logger: silentLogger })(42, "hello");
        expect(sendMessage).toHaveBeenCalledWith(42, "hello", { link_preview_options: { is_disabled: true } });
    });

    it("logs a failed message instead of throwing", async () => {
        const { logger, warn } = spyLogger();
        const sendMessage = vi.fn().mockRejectedValue(new Error("Call to 'sendMessage' failed! (403: Forbidden)"));
        await createTextSender({ api: { sendMessage }, logger })(42, "hi");
        expect(warn).toHaveBeenCalledWith(
            { chatId: 42, error: "Call to 'sendMessage' failed! (403: Forbidden)" },
            "telegram message failed",
        );
    });
});
