const mongoose = require("mongoose");

const siteSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, unique: true },
    clientName: { type: String, required: true },
    siteName: { type: String, required: true },
    eboVersion: { type: String },
    connectionType: {
      type: String,
      enum: ["Enterprise Server", "AS-P Direct", "SmartConnectorREST", "EBO EWS SOAP", "EBO WebStation", "Unknown"],
      default: "Unknown"
    },
    serverUrl: { type: String },
    baseUrl: { type: String },
    ewsUrl: { type: String },
    alarmEndpointPath: { type: String, default: "/alarms/active" },
    pointEndpointPath: { type: String, default: "/points/read" },
    username: { type: String },
    password: { type: String },
    enabled: { type: Boolean, default: false },
    pollingEnabled: { type: Boolean, default: false },
    pollIntervalMinutes: { type: Number, default: 5, min: 1 },
    pollDays: {
      type: [Number],
      default: [0, 1, 2, 3, 4, 5, 6]
    },
    pollStartTime: { type: String, default: "00:00" },
    pollEndTime: { type: String, default: "23:59" },
    alarmPriorityFilter: {
      type: [String],
      default: ["Critical", "High"]
    },
    pointDefinitions: [
      {
        equipmentName: { type: String },
        pointName: { type: String },
        sourcePath: { type: String },
        unit: { type: String }
      }
    ],
    status: {
      type: String,
      enum: ["Active", "Pilot", "Disabled"],
      default: "Pilot"
    },
    lastConnectionTestAt: { type: Date },
    lastConnectionOk: { type: Boolean },
    lastConnectionMessage: { type: String },
    lastAlarmPollAt: { type: Date },
    lastAlarmPollOk: { type: Boolean },
    lastAlarmPollMessage: { type: String },
    lastAlarmCount: { type: Number },
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
