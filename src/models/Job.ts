import JobType from "@/types/job";
import mongoose from "mongoose";

const JobSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      unique: true,
    },
    bidPlaced: {
      type: Boolean,
      default: false,
    },
    lastSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<Document & JobType>("Job", JobSchema);
