const express = require("express");
const Point = require("../models/Point");

const router = express.Router();

router.get("/latest", async (req, res) => {
  try {
    const latestPoints = await Point.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: {
            siteId: "$siteId",
            sourcePath: "$sourcePath"
          },
          point: { $first: "$$ROOT" }
        }
      },
      { $replaceRoot: { newRoot: "$point" } },
      { $sort: { clientName: 1, siteName: 1, equipmentName: 1, pointName: 1 } }
    ]);

    res.json(latestPoints);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/client/:clientName", async (req, res) => {
  try {
    const points = await Point.find({
      clientName: req.params.clientName
    })
      .sort({ timestamp: -1 })
      .limit(1000);

    res.json(points);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/equipment/:equipmentName", async (req, res) => {
  try {
    const points = await Point.find({
      equipmentName: req.params.equipmentName
    })
      .sort({ timestamp: -1 })
      .limit(1000);

    res.json(points);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
