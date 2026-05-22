const mongoose = require("mongoose");

const pointSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true },
    clientName: { type: String, required: true },
    siteName: { type: String, required: true },
    equipmentName: { type: String, required: true },
    pointName: { type: String, required: true },
    sourcePath: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
    unit: { type: String },
    timestamp: { type: Date, default: Date.now },
    rawData: { type: Object }
  },
  {
    timestamps: true
  }
);

pointSchema.index({ siteId: 1, sourcePath: 1, timestamp: -1 });
pointSchema.index({ clientName: 1, equipmentName: 1, pointName: 1, timestamp: -1 });

module.exports = mongoose.model("Point", pointSchema);
