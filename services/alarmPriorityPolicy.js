const DEFAULT_URGENT_PRIORITIES = ["Critical", "High"];
const DEFAULT_CRITICAL_PRIORITIES = ["Critical"];
const DEFAULT_CRITICAL_KEYWORDS = ["smoke", "fire", "freeze", "leak", "life safety"];
const DEFAULT_HIGH_KEYWORDS = [
  "offline",
  "communication",
  "comm",
  "compressor",
  "lockout",
  "fan",
  "airflow",
  "flow"
];

function evaluateAlarmPriority(alarm, site = {}) {
  const reasons = [];
  const text = [
    alarm.alarmName,
    alarm.message,
    alarm.sourcePath,
    alarm.equipmentName,
    alarm.category
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const priority = String(alarm.priority || "");
  const criticalPriorities = normalizeList(site.criticalPriorityFilter, DEFAULT_CRITICAL_PRIORITIES);
  const urgentPriorities = normalizeList(site.alarmPriorityFilter, DEFAULT_URGENT_PRIORITIES);
  const criticalKeywords = normalizeList(site.criticalAlarmKeywords, DEFAULT_CRITICAL_KEYWORDS);
  const highKeywords = normalizeList(site.highAlarmKeywords, DEFAULT_HIGH_KEYWORDS);
  const urgentCategories = normalizeList(site.urgentAlarmCategories, []);

  const matchedCriticalKeyword = findKeyword(text, criticalKeywords);
  if (criticalPriorities.includes(priority)) {
    reasons.push(`EBO priority ${priority} is configured as critical`);
    return buildResult("Critical", reasons);
  }

  if (matchedCriticalKeyword) {
    reasons.push(`Matched critical keyword "${matchedCriticalKeyword}"`);
    return buildResult("Critical", reasons);
  }

  if (urgentPriorities.includes(priority)) {
    reasons.push(`EBO priority ${priority} is configured for urgent review`);
    return buildResult("High", reasons);
  }

  const matchedHighKeyword = findKeyword(text, highKeywords);
  if (matchedHighKeyword) {
    reasons.push(`Matched high-priority keyword "${matchedHighKeyword}"`);
    return buildResult("High", reasons);
  }

  if (urgentCategories.map((category) => category.toLowerCase()).includes(String(alarm.category || "").toLowerCase())) {
    reasons.push(`Category ${alarm.category} is configured for urgent review`);
    return buildResult("High", reasons);
  }

  if (priority === "Medium") {
    reasons.push("Medium source priority");
    return buildResult("Elevated", reasons);
  }

  reasons.push("No urgent policy match");
  return buildResult("Normal", reasons);
}

function buildResult(actionPriority, reasons) {
  return {
    actionPriority,
    needsAttention: ["Critical", "High"].includes(actionPriority),
    attentionReason: reasons
  };
}

function normalizeList(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const values = Array.isArray(value)
    ? value
    : String(value || "").split(",");

  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function findKeyword(text, keywords) {
  return keywords.find((keyword) => text.includes(String(keyword).toLowerCase()));
}

module.exports = {
  evaluateAlarmPriority
};
