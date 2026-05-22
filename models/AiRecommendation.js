const mongoose = require("mongoose");

const aiRecommendationSchema = new mongoose.Schema(
  {
    siteId: { type: String },
    clientName: { type: String, required: true },
    siteName: { type: String, required: true },
    equipmentName: { type: String },
    issueType: { type: String, required: true },
    alarmId: { type: mongoose.Schema.Types.ObjectId, ref: "Alarm" },
    aiSummary: { type: String, required: true },
    recommendedAction: { type: String },
    confidence: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium"
    },
    status: {
      type: String,
      enum: ["Draft", "Reviewed", "Dismissed"],
      default: "Draft"
    }
  },
  {
    timestamps: true
  }
);

aiRecommendationSchema.index({ clientName: 1, siteName: 1, createdAt: -1 });

module.exports = mongoose.model("AiRecommendation", aiRecommendationSchema);
