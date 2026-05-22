const Alarm = require("../models/Alarm");
const ServiceIssue = require("../models/ServiceIssue");

const OPEN_STATUSES = ["Open", "In Progress"];

async function createServiceIssueFromAlarm(alarmId, options = {}) {
  const alarm = await Alarm.findById(alarmId);

  if (!alarm) {
    const error = new Error("Alarm not found");
    error.statusCode = 404;
    throw error;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existingIssue = await ServiceIssue.findOne({
    clientName: alarm.clientName,
    siteName: alarm.siteName,
    equipmentName: alarm.equipmentName,
    issueTitle: buildIssueTitle(alarm),
    status: { $in: OPEN_STATUSES },
    createdAt: { $gte: since }
  }).sort({ createdAt: -1 });

  if (existingIssue) {
    alarm.serviceIssueCreated = true;
    alarm.serviceIssueId = existingIssue._id.toString();
    alarm.serviceIssueStatus = existingIssue.status;
    await alarm.save();

    return {
      issue: existingIssue,
      created: false,
      duplicatePrevented: true
    };
  }

  const issue = await ServiceIssue.create({
    alarmId: alarm._id,
    clientName: alarm.clientName,
    siteName: alarm.siteName,
    equipmentName: alarm.equipmentName,
    issueTitle: buildIssueTitle(alarm),
    status: "Open",
    priority: alarm.priority === "Critical" ? "Critical" : "High",
    source: "BMS Alarm",
    description:
      options.description ||
      `Alarm received from EBO. ${alarm.message || alarm.alarmName}`,
    assignedEngineer: options.assignedEngineer || alarm.assignedEngineer,
    notifyClient: options.notifyClient === true
  });

  alarm.serviceIssueCreated = true;
  alarm.serviceIssueId = issue._id.toString();
  alarm.serviceIssueStatus = issue.status;
  await alarm.save();

  return {
    issue,
    created: true,
    duplicatePrevented: false
  };
}

function buildIssueTitle(alarm) {
  return `${alarm.priority || "High"} BMS Alarm - ${alarm.equipmentName || "Equipment"} ${alarm.alarmName}`;
}

module.exports = {
  createServiceIssueFromAlarm
};
