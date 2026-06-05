require("dotenv").config();

const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");

const alarmRoutes = require("./routes/alarms");
const aiRoutes = require("./routes/ai");
const analyticsRoutes = require("./routes/analytics");
const demoGatewayRoutes = require("./routes/demoGateway");
const pointRoutes = require("./routes/points");
const serviceIssueRoutes = require("./routes/serviceIssues");
const siteRoutes = require("./routes/sites");
const { collectAlarms } = require("./services/alarmCollector");
const { collectPoints } = require("./services/pointCollector");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/admin", express.static("public"));

app.use("/api/alarms", alarmRoutes);
app.use("/api/points", pointRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/service-issues", serviceIssueRoutes);
app.use("/demo-gateway", demoGatewayRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    app: "Triton AI Alarm Insights",
    time: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3010;
const MONGO_URI = process.env.MONGO_URI;

async function startServer() {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    app.listen(PORT, () => {
      console.log(`Triton AI Alarm Insights running on port ${PORT}`);
    });

    const intervalSeconds = Number(process.env.POLL_INTERVAL_SECONDS || 30);

    setInterval(async () => {
      await collectAlarms();
    }, intervalSeconds * 1000);

    const pointIntervalSeconds = Number(process.env.POINT_POLL_INTERVAL_SECONDS || 300);

    setInterval(async () => {
      await collectPoints();
    }, pointIntervalSeconds * 1000);

    // Run once on startup.
    await collectAlarms();
    await collectPoints();
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer
};
