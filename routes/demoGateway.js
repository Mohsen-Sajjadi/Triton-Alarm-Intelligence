const express = require("express");

const router = express.Router();

router.get("/alarms/active", (req, res) => {
  res.json({
    alarms: [
      {
        sourcePath: "/Demo Building/AHU-1/Supply Air Temperature",
        alarmName: "Supply Air Temperature High",
        equipmentName: "AHU-1",
        priority: "Critical",
        eboPriority: 40,
        state: "Active",
        acknowledged: false,
        message: "Supply air temperature is above setpoint.",
        occurredAt: new Date(Date.now() - 12 * 60 * 1000).toISOString()
      },
      {
        sourcePath: "/Demo Building/CHW Plant/Chiller-1/Status",
        alarmName: "Chiller Failed To Start",
        equipmentName: "Chiller-1",
        priority: "High",
        eboPriority: 80,
        state: "Active",
        acknowledged: false,
        message: "Start command issued but status did not change to running.",
        occurredAt: new Date(Date.now() - 27 * 60 * 1000).toISOString()
      },
      {
        sourcePath: "/Demo Building/VAV-204/Zone Temperature",
        alarmName: "Zone Temperature Low",
        equipmentName: "VAV-204",
        priority: "Medium",
        eboPriority: 150,
        state: "Acknowledged",
        acknowledged: true,
        message: "Zone temperature is below the occupied heating setpoint.",
        occurredAt: new Date(Date.now() - 44 * 60 * 1000).toISOString()
      }
    ]
  });
});

router.post("/points/read", (req, res) => {
  const requestedPoints = Array.isArray(req.body?.points) ? req.body.points : [];

  res.json({
    points: requestedPoints.map((sourcePath, index) => ({
      sourcePath,
      value: 68 + index,
      unit: "degF",
      timestamp: new Date().toISOString()
    }))
  });
});

module.exports = router;
