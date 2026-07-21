const express = require("express");
const Alarm = require("../models/Alarm");
const ServiceIssue = require("../models/ServiceIssue");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const issues = await ServiceIssue.find().sort({ createdAt: -1 }).limit(500);
    res.json(issues);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const issue = await ServiceIssue.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (!issue) {
      return res.status(404).json({ error: "Service issue not found" });
    }

    return res.json(issue);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const issue = await ServiceIssue.findByIdAndDelete(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: "Service issue not found" });
    }

    if (issue.alarmId) {
      await Alarm.findByIdAndUpdate(issue.alarmId, {
        $set: { serviceIssueCreated: false },
        $unset: {
          serviceIssueId: 1,
          serviceIssueStatus: 1,
          assignedEngineer: 1
        }
      });
    }

    return res.json({ deleted: true, id: issue._id });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
