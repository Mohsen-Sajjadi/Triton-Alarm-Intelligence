const Alarm = require("../models/Alarm");
const { evaluateAlarmPriority } = require("./alarmPriorityPolicy");

async function recalculateAlarmPolicyForSite(site) {
  if (!site?.siteId) {
    return { updated: 0, attention: 0 };
  }

  const alarms = await Alarm.find({
    siteId: site.siteId,
    state: { $in: ["Active", "Acknowledged"] }
  });

  let attention = 0;
  for (const alarm of alarms) {
    const result = evaluateAlarmPriority(alarm.toObject(), site);
    alarm.actionPriority = result.actionPriority;
    alarm.needsAttention = result.needsAttention;
    alarm.attentionReason = result.attentionReason;
    await alarm.save();
    if (result.needsAttention) attention += 1;
  }

  return {
    updated: alarms.length,
    attention
  };
}

module.exports = {
  recalculateAlarmPolicyForSite
};
