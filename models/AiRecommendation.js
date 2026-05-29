const mongoose = require("mongoose");

const aiRecommendationSchema = new mongoose.Schema(
  {
    siteId: { type: String },
    clientName: { type: String, required: true },
    siteName: { type: String, required: true },
    equipmentName: { type: String },
    issueType: { type: String, required: true },
    alarmId: { type: mongoose.Schema.Types.ObjectId, ref: "Alarm" },
    relatedAlarmIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Alarm" }],
    provider: { type: String, default: "local-rules" },
    model: { type: String },
    promptVersion: { type: String, default: "alarm-analysis-v1" },
    aiSummary: { type: String, required: true },
    likelyCause: { type: String },
    recommendedAction: { type: String },
    urgency: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium"
    },
    technicianRequired: { type: Boolean, default: false },
    ticketDraft: { type: String },
    evidence: [{ type: String }],
    riskNotes: [{ type: String }],
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
