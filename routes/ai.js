const express = require("express");
const Alarm = require("../models/Alarm");
const AiRecommendation = require("../models/AiRecommendation");

const router = express.Router();

router.post("/summarize-alarm", async (req, res) => {
  try {
    const { alarmId } = req.body;

    if (!alarmId) {
      return res.status(400).json({ error: "alarmId is required" });
    }

    const alarm = await Alarm.findById(alarmId);

    if (!alarm) {
      return res.status(404).json({ error: "Alarm not found" });
    }

    const recommendation = await AiRecommendation.create({
      siteId: alarm.siteId,
      clientName: alarm.clientName,
      siteName: alarm.siteName,
      equipmentName: alarm.equipmentName,
      issueType: "Alarm Summary",
      alarmId: alarm._id,
      aiSummary: `${alarm.equipmentName || "Equipment"} has a ${alarm.priority || "priority"} alarm: ${alarm.alarmName}. Current state is ${alarm.state}.`,
      recommendedAction: buildRecommendedAction(alarm),
      confidence: "Medium"
    });

    return res.status(201).json(recommendation);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/recommend-action", async (req, res) => {
  try {
    const { alarmId } = req.body;

    if (!alarmId) {
      return res.status(400).json({ error: "alarmId is required" });
    }

    const alarm = await Alarm.findById(alarmId);

    if (!alarm) {
      return res.status(404).json({ error: "Alarm not found" });
    }

    return res.json({
      alarmId,
      recommendedAction: buildRecommendedAction(alarm),
      confidence: "Medium"
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/monthly-report", async (req, res) => {
  res.status(501).json({
    error: "Monthly AI report generation is planned for a later phase."
  });
});

router.post("/root-cause-analysis", async (req, res) => {
  res.status(501).json({
    error: "Root-cause grouping is planned for a later phase."
  });
});

function buildRecommendedAction(alarm) {
  const text = `${alarm.alarmName} ${alarm.message || ""}`.toLowerCase();

  if (text.includes("fan")) {
    return "Verify fan command and status, check VFD fault history, confirm airflow proof, and inspect starter or belt locally.";
  }

  if (text.includes("temp") || text.includes("temperature")) {
    return "Confirm sensor reading, compare against a field measurement, review setpoint, and check valve or damper response.";
  }

  if (text.includes("communication") || text.includes("offline")) {
    return "Check controller power, network connection, BACnet communication status, and recent device restarts.";
  }

  return "Review the EBO alarm details, confirm current equipment status, and check related command, status, sensor, and schedule points.";
}

module.exports = router;
