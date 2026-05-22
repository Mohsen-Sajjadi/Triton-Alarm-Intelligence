async function notifyCriticalAlarm(alarm) {
  if (process.env.ENABLE_NOTIFICATIONS !== "true") {
    console.log(`[Notification] Disabled. Critical alarm: ${alarm.alarmName}`);
    return {
      sent: false,
      reason: "Notifications disabled"
    };
  }

  /*
    Wire this to Microsoft Graph, SMTP, Teams, or your existing portal
    notification system when credentials and routing rules are confirmed.
  */
  console.log(
    `[Notification] Would notify ${process.env.TRITON_TEAM_EMAIL}: ${alarm.clientName} ${alarm.siteName} ${alarm.alarmName}`
  );

  return {
    sent: true,
    channel: "stub",
    recipient: process.env.TRITON_TEAM_EMAIL
  };
}

module.exports = {
  notifyCriticalAlarm
};
