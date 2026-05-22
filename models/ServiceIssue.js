const mongoose = require("mongoose");

const serviceIssueSchema = new mongoose.Schema(
  {
    alarmId: { type: mongoose.Schema.Types.ObjectId, ref: "Alarm" },
    clientName: { type: String, required: true },
    siteName: { type: String, required: true },
    equipmentName: { type: String },
    issueTitle: { type: String, required: true },
    status: {
      type: String,
      enum: ["Open", "In Progress", "Resolved", "Closed"],
      default: "Open"
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "High"
    },
    source: { type: String, default: "BMS Alarm" },
    description: { type: String },
    assignedEngineer: { type: String },
    notifyClient: { type: Boolean, default: false },
    externalIssueId: { type: String }
  },
  {
    timestamps: true
  }
);

serviceIssueSchema.index({
  clientName: 1,
  siteName: 1,
  equipmentName: 1,
  issueTitle: 1,
  status: 1
});

module.exports = mongoose.model("ServiceIssue", serviceIssueSchema);
