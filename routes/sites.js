const express = require("express");
const Site = require("../models/Site");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const sites = await Site.find().sort({ clientName: 1, siteName: 1 });
    res.json(sites);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const site = await Site.create(req.body);
    res.status(201).json(site);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/:siteId", async (req, res) => {
  try {
    const site = await Site.findOneAndUpdate(
      { siteId: req.params.siteId },
      req.body,
      { new: true, runValidators: true }
    );

    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    return res.json(site);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
