import { telegraf } from "./telegram";
import setup_commands from "./commands";

setup_commands(telegraf);

export { sendMessage, sendBidResultNotification } from "./telegram";
export { telegraf };

export const launchBot = async () => {
  try {
    return await new Promise((resolve) => {
      telegraf.launch(() => {
        resolve("Bot started");
      });
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error("[ERROR] launchBot:", e?.message);
    throw error;
  }
};
