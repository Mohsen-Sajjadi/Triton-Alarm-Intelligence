const mongoose = require("mongoose");

const alarmSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true },
    clientName: { type: String, required: true },
    siteName: { type: String, required: true },

    sourceSystem: {
      type: String,
      default: "Schneider EBO"
    },

    sourcePath: { type: String, required: true },
    alarmName: { type: String, required: true },
    equipmentName: { type: String },
    category: {
      type: String,
      enum: [
        "Plant",
        "AHU",
        "VAV",
        "Terminal Unit",
        "Network",
        "Sensor",
        "Communication",
        "Energy",
        "Comfort",
        "Safety",
        "Unknown"
      ],
      default: "Unknown"
    },

    priority: { type: String },
    eboPriority: { type: Number },
    actionPriority: {
      type: String,
      enum: ["Critical", "High", "Elevated", "Normal"],
      default: "Normal"
    },
    needsAttention: { type: Boolean, default: false },
    attentionReason: {
      type: [String],
      default: []
    },

    state: {
      type: String,
      enum: ["Active", "Acknowledged", "ReturnedToNormal", "Unknown"],
      default: "Unknown"
    },

    acknowledged: { type: Boolean, default: false },

    message: { type: String },

    occurredAt: { type: Date },
    returnedToNormalAt: { type: Date },

    serviceIssueCreated: { type: Boolean, default: false },
    serviceIssueId: { type: String },
    serviceIssueStatus: { type: String },
    assignedEngineer: { type: String },

    rawData: { type: Object }
  },
  {
    timestamps: true
  }
);

// Prevent duplicate active alarm records from the same source event.
alarmSchema.index(
  {
    siteId: 1,
    sourcePath: 1,
    alarmName: 1,
    occurredAt: 1
  },
  { unique: true }
);
alarmSchema.index({ clientName: 1, siteName: 1, priority: 1, state: 1 });
alarmSchema.index({ siteId: 1, actionPriority: 1, needsAttention: 1, state: 1 });
alarmSchema.index({ equipmentName: 1, alarmName: 1, occurredAt: -1 });

module.exports = mongoose.model("Alarm", alarmSchema);
