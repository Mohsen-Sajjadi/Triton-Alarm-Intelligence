const express = require("express");
const Alarm = require("../models/Alarm");
const { createServiceIssueFromAlarm } = require("../services/serviceSyncService");

const router = express.Router();

// Get all alarms.
router.get("/", async (req, res) => {
  try {
    const alarms = await Alarm.find().sort({ occurredAt: -1 }).limit(500);

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active alarms.
router.get("/active", async (req, res) => {
  try {
    const query = {
      state: { $in: ["Active", "Acknowledged"] }
    };

    if (req.query.siteId) {
      query.siteId = req.query.siteId;
    }

    const limit = Math.min(Number(req.query.limit || 1000), 5000);
    const alarms = await Alarm.find(query).sort({
      occurredAt: -1,
      "rawData.SEQNO": -1,
      updatedAt: -1
    }).limit(limit);

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const query = {};

    if (req.query.siteId) {
      query.siteId = req.query.siteId;
    }

    if (req.query.state) {
      query.state = req.query.state;
    } else {
      query.state = { $nin: ["Active", "Acknowledged"] };
    }

    const limit = Math.min(Number(req.query.limit || 1000), 5000);
    const alarms = await Alarm.find(query).sort({
      returnedToNormalAt: -1,
      occurredAt: -1,
      updatedAt: -1
    }).limit(limit);

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active alarms that match each site's attention policy.
router.get("/attention", async (req, res) => {
  try {
    const query = {
      needsAttention: true,
      state: { $in: ["Active", "Acknowledged"] }
    };

    if (req.query.siteId) {
      query.siteId = req.query.siteId;
    }

    const limit = Math.min(Number(req.query.limit || 1000), 5000);
    const alarms = await Alarm.find(query).sort({
      actionPriority: 1,
      occurredAt: -1,
      updatedAt: -1
    }).limit(limit);

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get critical alarms.
router.get("/critical", async (req, res) => {
  try {
    const alarms = await Alarm.find({
      actionPriority: "Critical",
      state: { $in: ["Active", "Acknowledged"] }
    }).sort({ occurredAt: -1 });

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get alarms by client.
router.get("/client/:clientName", async (req, res) => {
  try {
    const alarms = await Alarm.find({
      clientName: req.params.clientName
    }).sort({ occurredAt: -1 });

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get alarms by site.
router.get("/site/:siteName", async (req, res) => {
  try {
    const alarms = await Alarm.find({
      $or: [{ siteId: req.params.siteName }, { siteName: req.params.siteName }]
    }).sort({ occurredAt: -1 });

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/create-service-ticket", async (req, res) => {
  try {
    const { alarmId, assignedEngineer, notifyClient, description } = req.body;

    if (!alarmId) {
      return res.status(400).json({ error: "alarmId is required" });
    }

    const result = await createServiceIssueFromAlarm(alarmId, {
      assignedEngineer,
      notifyClient,
      description
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Mark alarm as returned to normal manually, for testing.
router.patch("/:id/return-to-normal", async (req, res) => {
  try {
    const alarm = await Alarm.findByIdAndUpdate(
      req.params.id,
      {
        state: "ReturnedToNormal",
        returnedToNormalAt: new Date()
      },
      { new: true }
    );

    if (!alarm) {
      return res.status(404).json({ error: "Alarm not found" });
    }

    return res.json(alarm);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
