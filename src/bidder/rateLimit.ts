const WINDOW_MS = 60 * 60 * 1000;
const MAX_BIDS = 5;
const timestamps: number[] = [];

export const canPlaceBidThisHour = (): boolean => {
  const now = Date.now();
  while (timestamps.length > 0 && now - timestamps[0] > WINDOW_MS) {
    timestamps.shift();
  }
  return timestamps.length < MAX_BIDS;
};

export const recordBidPlaced = () => {
  timestamps.push(Date.now());
};
