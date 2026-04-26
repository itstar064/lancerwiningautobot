import config from "@/config";

const timestamps: number[] = [];

export const canPlaceBidThisHour = (): boolean => {
  const { BID_RATE_WINDOW_MS: win, BID_MAX_PER_WINDOW: max } = config;
  const now = Date.now();
  while (timestamps.length > 0 && now - timestamps[0] > win) {
    timestamps.shift();
  }
  return timestamps.length < max;
};

export const recordBidPlaced = () => {
  timestamps.push(Date.now());
};
