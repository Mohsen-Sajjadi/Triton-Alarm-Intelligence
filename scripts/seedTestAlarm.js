require("dotenv").config();

const mongoose = require("mongoose");
const Alarm = require("../models/Alarm");
const Point = require("../models/Point");
const Site = require("../models/Site");

async function seedTestData() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  await mongoose.connect(process.env.MONGO_URI);

  await Site.findOneAndUpdate(
    { siteId: "pilot-site-001" },
    {
      siteId: "pilot-site-001",
      clientName: "Pilot Client",
      siteName: "Main Building",
      eboVersion: "TBD",
      connectionType: "Enterprise Server",
      serverUrl: "https://client-smartconnector-server/api",
      status: "Pilot",
      leadEngineer: "TBD",
      enterpriseServerAvailable: true,
      ewsEnabled: false,
      smartConnectorAvailable: false,
      readOnlyUserCreated: false,
      networkAccessConfirmed: false,
      cybersecurityApproved: false
    },
    { upsert: true, new: true }
  );

  const alarm = await Alarm.create({
    siteId: "pilot-site-001",
    clientName: "Pilot Client",
    siteName: "Main Building",
    sourcePath: "/Main Building/AHU-1/Supply Air Temp",
    alarmName: "Supply Air Temperature High",
    equipmentName: "AHU-1",
    category: "AHU",
    priority: "Critical",
    eboPriority: 40,
    state: "Active",
    acknowledged: false,
    message: "Supply air temperature is above setpoint.",
    occurredAt: new Date(),
    rawData: {
      source: "seedTestAlarm"
    }
  });

  console.log(`Seeded test alarm ${alarm._id}`);

  const point = await Point.create({
    siteId: "pilot-site-001",
    clientName: "Pilot Client",
    siteName: "Main Building",
    equipmentName: "AHU-1",
    pointName: "Discharge Air Temperature",
    sourcePath: "/AHU-1/DAT",
    value: 58.4,
    unit: "F",
    timestamp: new Date(),
    rawData: {
      source: "seedTestAlarm"
    }
  });

  console.log(`Seeded test point ${point._id}`);
  await mongoose.disconnect();
}

seedTestData().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
