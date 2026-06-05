const express = require("express");
const Site = require("../models/Site");
const { fetchActiveAlarms } = require("../connectors/eboAlarmConnector");
const { fetchEwsWebServiceInformation } = require("../connectors/eboEwsSoapConnector");
const { testWebStationAccess } = require("../connectors/eboWebStationConnector");
const { reconcileActiveAlarms, upsertAlarm } = require("../services/alarmCollector");

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
    const site = await Site.create(normalizeSiteBody(req.body));
    res.status(201).json(site);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/:siteId", async (req, res) => {
  try {
    const site = await Site.findOneAndUpdate(
      { siteId: req.params.siteId },
      normalizeSiteBody(req.body),
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

router.delete("/:siteId", async (req, res) => {
  try {
    const site = await Site.findOneAndDelete({ siteId: req.params.siteId });

    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    return res.json({ deleted: true, siteId: site.siteId });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/test-all", async (req, res) => {
  try {
    const sites = await Site.find({ enabled: true }).sort({ clientName: 1, siteName: 1 }).lean();
    const results = await runWithConcurrency(sites, 5, testSiteConnection);

    return res.json({
      ok: results.every((result) => result.ok),
      total: results.length,
      passed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/fetch-all-alarms", async (req, res) => {
  try {
    const sites = await Site.find({
      enabled: true,
      pollingEnabled: true
    }).sort({ clientName: 1, siteName: 1 }).lean();

    const results = await runWithConcurrency(sites, 5, fetchAndSaveSiteAlarms);

    return res.json({
      ok: results.every((result) => result.ok),
      total: results.length,
      fetched: results.reduce((sum, result) => sum + (result.fetched || 0), 0),
      saved: results.reduce((sum, result) => sum + (result.saved || 0), 0),
      returnedToNormal: results.reduce((sum, result) => sum + (result.returnedToNormal || 0), 0),
      failed: results.filter((result) => !result.ok).length,
      results
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/:siteId/test-connection", async (req, res) => {
  try {
    const site = await Site.findOne({ siteId: req.params.siteId }).lean();

    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    const alarms = await fetchActiveAlarms(site, { throwOnError: true });

    await Site.findOneAndUpdate(
      { siteId: site.siteId },
      {
        lastConnectionTestAt: new Date(),
        lastConnectionOk: true,
        lastConnectionMessage: `Connection succeeded. Fetched ${alarms.length} alarms.`,
        lastAlarmCount: alarms.length
      }
    );

    return res.json({
      ok: true,
      alarmCount: alarms.length,
      connector: alarms[0]?.rawData?.connector || site.connectionType,
      sampleAlarms: alarms.slice(0, 10)
    });
  } catch (error) {
    await Site.findOneAndUpdate(
      { siteId: req.params.siteId },
      {
        lastConnectionTestAt: new Date(),
        lastConnectionOk: false,
        lastConnectionMessage: error.message
      }
    );

    return res.status(500).json({
      ok: false,
      error: error.message,
      diagnostic: error.diagnostic
    });
  }
});

router.post("/:siteId/test-ews-info", async (req, res) => {
  try {
    const site = await Site.findOne({ siteId: req.params.siteId }).lean();

    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    const result = await fetchEwsWebServiceInformation(site);
    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
      diagnostic: error.diagnostic
    });
  }
});

router.post("/:siteId/test-webstation", async (req, res) => {
  try {
    const site = await Site.findOne({ siteId: req.params.siteId }).lean();

    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    const result = await testWebStationAccess(site);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
      diagnostic: error.diagnostic
    });
  }
});

router.post("/:siteId/fetch-alarms", async (req, res) => {
  try {
    const site = await Site.findOne({ siteId: req.params.siteId }).lean();

    if (!site) {
      return res.status(404).json({ error: "Site not found" });
    }

    const alarms = await fetchActiveAlarms(site, { throwOnError: true });
    const reconciliation = await reconcileActiveAlarms(site, alarms);
    const saved = [];

    for (const alarm of alarms) {
      const allowedPriority =
        !site.alarmPriorityFilter?.length ||
        site.alarmPriorityFilter.includes(alarm.priority);

      if (!allowedPriority) continue;

      saved.push(await upsertAlarm(alarm));
    }

    await Site.findOneAndUpdate(
      { siteId: site.siteId },
      {
        lastAlarmPollAt: new Date(),
        lastAlarmPollOk: true,
        lastAlarmPollMessage: `Fetched ${alarms.length} alarms, saved ${saved.length}, closed ${reconciliation.returnedToNormal}.`,
        lastAlarmCount: alarms.length
      }
    );

    return res.json({
      ok: true,
      fetched: alarms.length,
      saved: saved.length,
      returnedToNormal: reconciliation.returnedToNormal,
      connector: alarms[0]?.rawData?.connector || site.connectionType,
      sampleAlarms: alarms.slice(0, 10)
    });
  } catch (error) {
    await Site.findOneAndUpdate(
      { siteId: req.params.siteId },
      {
        lastAlarmPollAt: new Date(),
        lastAlarmPollOk: false,
        lastAlarmPollMessage: error.message
      }
    );

    return res.status(500).json({
      ok: false,
      error: error.message,
      diagnostic: error.diagnostic
    });
  }
});

async function testSiteConnection(site) {
  try {
    const alarms = await fetchActiveAlarms(site, { throwOnError: true });

    await Site.findOneAndUpdate(
      { siteId: site.siteId },
      {
        lastConnectionTestAt: new Date(),
        lastConnectionOk: true,
        lastConnectionMessage: `Connection succeeded. Fetched ${alarms.length} alarms.`,
        lastAlarmCount: alarms.length
      }
    );

    return {
      ok: true,
      siteId: site.siteId,
      clientName: site.clientName,
      siteName: site.siteName,
      connector: alarms[0]?.rawData?.connector || site.connectionType,
      alarmCount: alarms.length
    };
  } catch (error) {
    await Site.findOneAndUpdate(
      { siteId: site.siteId },
      {
        lastConnectionTestAt: new Date(),
        lastConnectionOk: false,
        lastConnectionMessage: error.message
      }
    );

    return {
      ok: false,
      siteId: site.siteId,
      clientName: site.clientName,
      siteName: site.siteName,
      connector: site.connectionType,
      error: error.message,
      diagnostic: error.diagnostic
    };
  }
}

async function fetchAndSaveSiteAlarms(site) {
  try {
    const alarms = await fetchActiveAlarms(site, { throwOnError: true });
    const reconciliation = await reconcileActiveAlarms(site, alarms);
    const saved = [];

    for (const alarm of alarms) {
      const allowedPriority =
        !site.alarmPriorityFilter?.length ||
        site.alarmPriorityFilter.includes(alarm.priority);

      if (!allowedPriority) continue;

      saved.push(await upsertAlarm(alarm));
    }

    await Site.findOneAndUpdate(
      { siteId: site.siteId },
      {
        lastAlarmPollAt: new Date(),
        lastAlarmPollOk: true,
        lastAlarmPollMessage: `Fetched ${alarms.length} alarms, saved ${saved.length}, closed ${reconciliation.returnedToNormal}.`,
        lastAlarmCount: alarms.length
      }
    );

    return {
      ok: true,
      siteId: site.siteId,
      clientName: site.clientName,
      siteName: site.siteName,
      connector: alarms[0]?.rawData?.connector || site.connectionType,
      fetched: alarms.length,
      saved: saved.length,
      returnedToNormal: reconciliation.returnedToNormal
    };
  } catch (error) {
    await Site.findOneAndUpdate(
      { siteId: site.siteId },
      {
        lastAlarmPollAt: new Date(),
        lastAlarmPollOk: false,
        lastAlarmPollMessage: error.message
      }
    );

    return {
      ok: false,
      siteId: site.siteId,
      clientName: site.clientName,
      siteName: site.siteName,
      connector: site.connectionType,
      error: error.message,
      diagnostic: error.diagnostic
    };
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let nextIndex = 0;

  async function runNext() {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= items.length) return;

    results[index] = await worker(items[index]);
    await runNext();
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runNext())
  );

  return results;
}

function normalizeSiteBody(body) {
  const normalized = { ...body };

  if (!normalized.baseUrl && normalized.serverUrl) {
    normalized.baseUrl = normalized.serverUrl;
  }

  if (!normalized.serverUrl && normalized.baseUrl) {
    normalized.serverUrl = normalized.baseUrl;
  }

  if (typeof normalized.alarmPriorityFilter === "string") {
    normalized.alarmPriorityFilter = normalized.alarmPriorityFilter
      .split(",")
      .map((priority) => priority.trim())
      .filter(Boolean);
  }

  normalized.pollIntervalMinutes = Math.max(
    Number(normalized.pollIntervalMinutes || 5),
    1
  );

  if (typeof normalized.pollDays === "string") {
    normalized.pollDays = normalized.pollDays
      .split(",")
      .map((day) => Number(day.trim()))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  }

  if (Array.isArray(normalized.pollDays)) {
    normalized.pollDays = normalized.pollDays
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b);
  }

  if (!normalized.pollDays?.length) {
    normalized.pollDays = [0, 1, 2, 3, 4, 5, 6];
  }

  normalized.pollStartTime = isValidTime(normalized.pollStartTime)
    ? normalized.pollStartTime
    : "00:00";
  normalized.pollEndTime = isValidTime(normalized.pollEndTime)
    ? normalized.pollEndTime
    : "23:59";

  return normalized;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

module.exports = router;
