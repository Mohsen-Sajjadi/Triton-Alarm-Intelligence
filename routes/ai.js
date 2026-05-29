const express = require("express");
const AiRecommendation = require("../models/AiRecommendation");
const { analyzeAlarm, analyzeSite } = require("../services/aiAlarmAnalysisService");

const router = express.Router();

router.get("/recommendations", async (req, res) => {
  try {
    const query = {};
    if (req.query.siteId) query.siteId = req.query.siteId;
    if (req.query.alarmId) query.alarmId = req.query.alarmId;

    const recommendations = await AiRecommendation.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit || 50), 200));

    return res.json(recommendations);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/analyze-alarm", async (req, res) => {
  try {
    const { alarmId } = req.body;
    if (!alarmId) {
      return res.status(400).json({ error: "alarmId is required" });
    }

    const recommendation = await analyzeAlarm(alarmId, req.body);
    return res.status(201).json(recommendation);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/summarize-alarm", async (req, res) => {
  try {
    const { alarmId } = req.body;
    if (!alarmId) {
      return res.status(400).json({ error: "alarmId is required" });
    }

    const recommendation = await analyzeAlarm(alarmId, req.body);
    return res.status(201).json(recommendation);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/recommend-action", async (req, res) => {
  try {
    const { alarmId } = req.body;
    if (!alarmId) {
      return res.status(400).json({ error: "alarmId is required" });
    }

    const recommendation = await analyzeAlarm(alarmId, req.body);
    return res.json({
      alarmId,
      recommendedAction: recommendation.recommendedAction,
      likelyCause: recommendation.likelyCause,
      urgency: recommendation.urgency,
      technicianRequired: recommendation.technicianRequired,
      confidence: recommendation.confidence
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/analyze-site", async (req, res) => {
  try {
    const { siteId } = req.body;
    if (!siteId) {
      return res.status(400).json({ error: "siteId is required" });
    }

    const analysis = await analyzeSite(siteId, req.body);
    return res.json(analysis);
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
  try {
    const { siteId } = req.body;
    if (!siteId) {
      return res.status(400).json({ error: "siteId is required" });
    }

    const analysis = await analyzeSite(siteId, req.body);
    return res.json(analysis);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
