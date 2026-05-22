const mongoose = require("mongoose");

const siteSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, unique: true },
    clientName: { type: String, required: true },
    siteName: { type: String, required: true },
    eboVersion: { type: String },
    connectionType: {
      type: String,
      enum: ["Enterprise Server", "AS-P Direct", "SmartConnectorREST", "Unknown"],
      default: "Unknown"
    },
    serverUrl: { type: String },
    status: {
      type: String,
      enum: ["Active", "Pilot", "Disabled"],
      default: "Pilot"
    },
    leadEngineer: { type: String },
    enterpriseServerAvailable: { type: Boolean, default: false },
    ewsEnabled: { type: Boolean, default: false },
    smartConnectorAvailable: { type: Boolean, default: false },
    readOnlyUserCreated: { type: Boolean, default: false },
    networkAccessConfirmed: { type: Boolean, default: false },
    cybersecurityApproved: { type: Boolean, default: false },
    notes: { type: String }
  },
  {
    timestamps: true
  }
);

siteSchema.index({ clientName: 1, siteName: 1 }, { unique: true });

module.exports = mongoose.model("Site", siteSchema);
