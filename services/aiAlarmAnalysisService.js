const axios = require("axios");
const Alarm = require("../models/Alarm");
const AiRecommendation = require("../models/AiRecommendation");

const PROMPT_VERSION = "alarm-analysis-v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    issueType: { type: "string" },
    summary: { type: "string" },
    likelyCause: { type: "string" },
    urgency: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
    confidence: { type: "string", enum: ["Low", "Medium", "High"] },
    technicianRequired: { type: "boolean" },
    recommendedAction: { type: "string" },
    ticketDraft: { type: "string" },
    evidence: {
      type: "array",
      items: { type: "string" }
    },
    riskNotes: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "issueType",
    "summary",
    "likelyCause",
    "urgency",
    "confidence",
    "technicianRequired",
    "recommendedAction",
    "ticketDraft",
    "evidence",
    "riskNotes"
  ]
};

async function analyzeAlarm(alarmId, options = {}) {
  const alarm = await Alarm.findById(alarmId).lean();
  if (!alarm) {
    const error = new Error("Alarm not found");
    error.statusCode = 404;
    throw error;
  }

  const context = await buildAlarmContext(alarm);
  const analysis = await runAiAnalysis(context, options);

  return AiRecommendation.create({
    siteId: alarm.siteId,
    clientName: alarm.clientName,
    siteName: alarm.siteName,
    equipmentName: alarm.equipmentName,
    issueType: analysis.issueType || "Alarm Analysis",
    alarmId: alarm._id,
    relatedAlarmIds: context.relatedAlarms.map((item) => item._id),
    provider: analysis.provider,
    model: analysis.model,
    promptVersion: PROMPT_VERSION,
    aiSummary: analysis.summary,
    likelyCause: analysis.likelyCause,
    recommendedAction: analysis.recommendedAction,
    urgency: analysis.urgency,
    technicianRequired: analysis.technicianRequired,
    ticketDraft: analysis.ticketDraft,
    evidence: analysis.evidence,
    riskNotes: analysis.riskNotes,
    confidence: analysis.confidence
  });
}

async function analyzeSite(siteId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 200);
  const activeAlarms = await Alarm.find({
    siteId,
    state: { $in: ["Active", "Acknowledged"] }
  })
    .sort({ priority: 1, occurredAt: -1 })
    .limit(limit)
    .lean();

  if (!activeAlarms.length) {
    return {
      provider: getProviderName(),
      model: getModelName(),
      summary: "No active alarms were found for this site.",
      urgency: "Low",
      confidence: "High",
      groups: []
    };
  }

  const groups = groupAlarms(activeAlarms);
  const context = {
    mode: "site",
    siteId,
    activeAlarmCount: activeAlarms.length,
    groups,
    newestAlarms: activeAlarms.slice(0, 12).map(slimAlarm)
  };

  const analysis = await runAiAnalysis(context, options);
  return {
    ...analysis,
    activeAlarmCount: activeAlarms.length,
    groups,
    newestAlarms: context.newestAlarms
  };
}

async function buildAlarmContext(alarm) {
  const since30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [sameSource, sameEquipment, activeForSite] = await Promise.all([
    Alarm.find({
      siteId: alarm.siteId,
      sourcePath: alarm.sourcePath,
      occurredAt: { $gte: since30Days }
    })
      .sort({ occurredAt: -1 })
      .limit(20)
      .lean(),
    Alarm.find({
      siteId: alarm.siteId,
      equipmentName: alarm.equipmentName,
      occurredAt: { $gte: since30Days }
    })
      .sort({ occurredAt: -1 })
      .limit(20)
      .lean(),
    Alarm.find({
      siteId: alarm.siteId,
      state: { $in: ["Active", "Acknowledged"] }
    })
      .sort({ occurredAt: -1 })
      .limit(30)
      .lean()
  ]);

  const relatedMap = new Map();
  for (const item of [...sameSource, ...sameEquipment]) {
    if (String(item._id) !== String(alarm._id)) {
      relatedMap.set(String(item._id), item);
    }
  }

  return {
    mode: "alarm",
    alarm: slimAlarm(alarm),
    repeatCount30Days: sameSource.length,
    sameEquipmentCount30Days: sameEquipment.length,
    relatedAlarms: Array.from(relatedMap.values()).slice(0, 12),
    activeSiteAlarms: activeForSite.slice(0, 12).map(slimAlarm)
  };
}

async function runAiAnalysis(context, options = {}) {
  if (shouldUseOpenAi(options)) {
    try {
      return await runOpenAiAnalysis(context);
    } catch (error) {
      console.error("[AI] OpenAI analysis failed, using local fallback:", error.message);
      return buildLocalAnalysis(context, {
        provider: "local-rules",
        model: "fallback",
        riskNotes: [`AI provider failed: ${error.message}`]
      });
    }
  }

  return buildLocalAnalysis(context);
}

function shouldUseOpenAi(options = {}) {
  const provider = String(options.provider || process.env.AI_PROVIDER || "").toLowerCase();
  return provider === "openai" && Boolean(process.env.OPENAI_API_KEY);
}

async function runOpenAiAnalysis(context) {
  const model = getModelName();
  const response = await axios.post(
    "https://api.openai.com/v1/responses",
    {
      model,
      reasoning: {
        effort: process.env.OPENAI_REASONING_EFFORT || "low"
      },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "alarm_analysis",
          strict: true,
          schema: ANALYSIS_SCHEMA
        }
      },
      max_output_tokens: 1200,
      input: [
        {
          role: "system",
          content: [
            "You are a senior building automation alarm triage assistant.",
            "Do not claim certainty. Use provided alarm evidence only.",
            "Do not recommend unsafe bypasses.",
            "Escalate safety, freeze, smoke, leak, and critical equipment risks.",
            "Write concise field-ready guidance for Triton service staff."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            context
          })
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );

  const content = extractResponseText(response.data);
  const parsed = JSON.parse(content || "{}");
  return normalizeAnalysis(parsed, {
    provider: "openai",
    model
  });
}

function extractResponseText(response) {
  if (response?.output_text) return response.output_text;

  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("");
}

function buildLocalAnalysis(context, overrides = {}) {
  const alarm = context.alarm || context.newestAlarms?.[0] || {};
  const text = [
    alarm.alarmName,
    alarm.message,
    alarm.sourcePath,
    alarm.category
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const urgency = getLocalUrgency(alarm, text, context);
  const technicianRequired = ["Critical", "High"].includes(urgency);
  const likelyCause = getLikelyCause(text);
  const recommendedAction = getRecommendedAction(text);

  return normalizeAnalysis(
    {
      issueType: context.mode === "site" ? "Site Alarm Review" : "Alarm Analysis",
      summary:
        context.mode === "site"
          ? `${context.activeAlarmCount} active alarms are present. The largest group is ${context.groups?.[0]?.label || "not grouped"}.`
          : `${alarm.equipmentName || "Equipment"} has an active ${alarm.priority || "unknown priority"} alarm: ${alarm.alarmName || "Unknown Alarm"}.`,
      likelyCause,
      urgency,
      confidence: "Medium",
      technicianRequired,
      recommendedAction,
      ticketDraft: buildTicketDraft(alarm, recommendedAction),
      evidence: buildEvidence(context),
      riskNotes: overrides.riskNotes || []
    },
    {
      provider: overrides.provider || getProviderName(),
      model: overrides.model || getModelName()
    }
  );
}

function normalizeAnalysis(analysis, metadata) {
  return {
    provider: metadata.provider,
    model: metadata.model,
    issueType: analysis.issueType || "Alarm Analysis",
    summary: analysis.summary || "Alarm analysis completed.",
    likelyCause: analysis.likelyCause || "Unknown",
    urgency: normalizeEnum(analysis.urgency, ["Low", "Medium", "High", "Critical"], "Medium"),
    confidence: normalizeEnum(analysis.confidence, ["Low", "Medium", "High"], "Medium"),
    technicianRequired: Boolean(analysis.technicianRequired),
    recommendedAction: analysis.recommendedAction || "Review alarm details and related equipment status.",
    ticketDraft: analysis.ticketDraft || "",
    evidence: Array.isArray(analysis.evidence) ? analysis.evidence.slice(0, 8) : [],
    riskNotes: Array.isArray(analysis.riskNotes) ? analysis.riskNotes.slice(0, 8) : []
  };
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function slimAlarm(alarm) {
  return {
    _id: alarm._id,
    siteId: alarm.siteId,
    clientName: alarm.clientName,
    siteName: alarm.siteName,
    equipmentName: alarm.equipmentName,
    sourcePath: alarm.sourcePath,
    alarmName: alarm.alarmName,
    category: alarm.category,
    priority: alarm.priority,
    eboPriority: alarm.eboPriority,
    state: alarm.state,
    acknowledged: alarm.acknowledged,
    message: alarm.message,
    occurredAt: alarm.occurredAt,
    lastSeenAt: alarm.updatedAt,
    connector: alarm.rawData?.connector,
    sequenceNumber: alarm.rawData?.SEQNO
  };
}

function groupAlarms(alarms) {
  const groups = new Map();
  for (const alarm of alarms) {
    const key = alarm.equipmentName || alarm.category || "Unknown";
    const group = groups.get(key) || {
      label: key,
      count: 0,
      critical: 0,
      high: 0,
      newest: null,
      examples: []
    };
    group.count += 1;
    if (alarm.priority === "Critical") group.critical += 1;
    if (alarm.priority === "High") group.high += 1;
    if (!group.newest || new Date(alarm.occurredAt) > new Date(group.newest)) {
      group.newest = alarm.occurredAt;
    }
    if (group.examples.length < 5) group.examples.push(slimAlarm(alarm));
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (b.critical !== a.critical) return b.critical - a.critical;
    if (b.high !== a.high) return b.high - a.high;
    return b.count - a.count;
  });
}

function getLocalUrgency(alarm, text, context) {
  if (alarm.priority === "Critical" || /smoke|fire|freeze|leak|life safety/.test(text)) {
    return "Critical";
  }
  if (alarm.priority === "High" || context.repeatCount30Days >= 5) return "High";
  if (alarm.priority === "Medium") return "Medium";
  return "Low";
}

function getLikelyCause(text) {
  if (/log sample|trend/.test(text)) return "Trend log collection issue, disabled log, offline source, or communication interruption.";
  if (/bacnet|offline|communication|comm/.test(text)) return "BACnet/device communication issue or controller/network availability problem.";
  if (/temp|temperature|humidity|rh/.test(text)) return "Sensor, setpoint, load, control loop, or equipment response issue.";
  if (/fan|airflow|flow/.test(text)) return "Fan/flow proof, VFD, command/status mismatch, belt, damper, or pump issue.";
  if (/compressor|lockout/.test(text)) return "Equipment safety lockout or repeated compressor fault requiring local inspection.";
  return "Unknown from alarm text alone.";
}

function getRecommendedAction(text) {
  if (/log sample|trend/.test(text)) {
    return "Check whether the trend log source exists, is enabled, and is producing samples. Verify device communication and trend interval configuration.";
  }
  if (/bacnet|offline|communication|comm/.test(text)) {
    return "Check device online status, BACnet network health, controller power, IP/MSTP routing, and recent controller restarts.";
  }
  if (/temp|temperature|humidity|rh/.test(text)) {
    return "Compare sensor value to a field reading, review setpoint/schedule, and verify valve, damper, fan, or heating/cooling response.";
  }
  if (/fan|airflow|flow/.test(text)) {
    return "Verify command versus proof/status, inspect VFD or starter faults, check belt/damper/filter condition, and confirm airflow or water flow sensor state.";
  }
  if (/compressor|lockout/.test(text)) {
    return "Review lockout/fault history, safeties, pressure/temperature conditions, and reset requirements before dispatch.";
  }
  return "Review EBO alarm details, related points, recent state changes, schedules, and equipment status before dispatch.";
}

function buildTicketDraft(alarm, action) {
  return [
    `${alarm.priority || "Priority"} BMS alarm at ${alarm.clientName || ""} ${alarm.siteName || ""}: ${alarm.alarmName || "Unknown Alarm"}.`,
    `Source: ${alarm.sourcePath || "Unknown"}.`,
    `Recommended checks: ${action}`
  ].join("\n");
}

function buildEvidence(context) {
  const evidence = [];
  if (context.alarm) {
    evidence.push(`Alarm priority: ${context.alarm.priority || "Unknown"}`);
    evidence.push(`Alarm state: ${context.alarm.state || "Unknown"}`);
    evidence.push(`Source path: ${context.alarm.sourcePath || "Unknown"}`);
  }
  if (typeof context.repeatCount30Days === "number") {
    evidence.push(`Same source alarms in last 30 days: ${context.repeatCount30Days}`);
  }
  if (typeof context.sameEquipmentCount30Days === "number") {
    evidence.push(`Same equipment alarms in last 30 days: ${context.sameEquipmentCount30Days}`);
  }
  if (context.activeAlarmCount) {
    evidence.push(`Active site alarms reviewed: ${context.activeAlarmCount}`);
  }
  return evidence;
}

function getProviderName() {
  return shouldUseOpenAi() ? "openai" : "local-rules";
}

function getModelName() {
  if (shouldUseOpenAi()) {
    return process.env.AI_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  }

  return process.env.AI_MODEL || process.env.OPENAI_MODEL || "local-rules";
}

module.exports = {
  analyzeAlarm,
  analyzeSite,
  buildAlarmContext
};
