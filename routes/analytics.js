const express = require("express");
const Alarm = require("../models/Alarm");

const router = express.Router();

router.get("/top-alarms", async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const alarms = await Alarm.aggregate([
      { $match: { occurredAt: { $gte: since } } },
      {
        $group: {
          _id: {
            clientName: "$clientName",
            siteName: "$siteName",
            equipmentName: "$equipmentName",
            alarmName: "$alarmName"
          },
          count: { $sum: 1 },
          latest: { $max: "$occurredAt" }
        }
      },
      { $sort: { count: -1, latest: -1 } },
      { $limit: 10 }
    ]);

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/repeated-alarms", async (req, res) => {
  try {
    const days = Number(req.query.days || 1);
    const minimumCount = Number(req.query.minimumCount || 3);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const alarms = await Alarm.aggregate([
      { $match: { occurredAt: { $gte: since } } },
      {
        $group: {
          _id: {
            clientName: "$clientName",
            siteName: "$siteName",
            equipmentName: "$equipmentName",
            alarmName: "$alarmName"
          },
          count: { $sum: 1 },
          first: { $min: "$occurredAt" },
          latest: { $max: "$occurredAt" }
        }
      },
      { $match: { count: { $gte: minimumCount } } },
      { $sort: { count: -1, latest: -1 } }
    ]);

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/alarm-duration", async (req, res) => {
  try {
    const alarms = await Alarm.aggregate([
      {
        $match: {
          occurredAt: { $ne: null },
          returnedToNormalAt: { $ne: null }
        }
      },
      {
        $project: {
          clientName: 1,
          siteName: 1,
          equipmentName: 1,
          alarmName: 1,
          priority: 1,
          occurredAt: 1,
          returnedToNormalAt: 1,
          durationMinutes: {
            $divide: [{ $subtract: ["$returnedToNormalAt", "$occurredAt"] }, 60000]
          }
        }
      },
      { $sort: { durationMinutes: -1 } },
      { $limit: 100 }
    ]);

    res.json(alarms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/equipment-health", async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const equipment = await Alarm.aggregate([
      { $match: { occurredAt: { $gte: since } } },
      {
        $group: {
          _id: {
            clientName: "$clientName",
            siteName: "$siteName",
            equipmentName: "$equipmentName"
          },
          criticalCount: {
            $sum: { $cond: [{ $eq: ["$priority", "Critical"] }, 1, 0] }
          },
          highCount: {
            $sum: { $cond: [{ $eq: ["$priority", "High"] }, 1, 0] }
          },
          totalAlarms: { $sum: 1 }
        }
      },
      {
        $addFields: {
          healthScore: {
            $max: [
              0,
              {
                $subtract: [
                  100,
                  {
                    $add: [
                      { $multiply: ["$criticalCount", 10] },
                      { $multiply: ["$highCount", 4] }
                    ]
                  }
                ]
              }
            ]
          }
        }
      },
      { $sort: { healthScore: 1, totalAlarms: -1 } }
    ]);

    res.json(equipment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
