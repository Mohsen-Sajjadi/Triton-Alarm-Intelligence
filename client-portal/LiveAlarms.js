import React, { useEffect, useState } from "react";
import axios from "axios";

const LiveAlarms = () => {
  const [alarms, setAlarms] = useState([]);

  useEffect(() => {
    fetchAlarms();

    const interval = setInterval(fetchAlarms, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchAlarms = async () => {
    try {
      const response = await axios.get("/api/alarms/active");
      setAlarms(response.data);
    } catch (error) {
      console.error("Failed to fetch alarms:", error);
    }
  };

  return (
    <div className="live-alarms-page">
      <h2>Live BMS Alarms</h2>

      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Site</th>
            <th>Equipment</th>
            <th>Alarm</th>
            <th>Category</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Time</th>
            <th>Ticket</th>
          </tr>
        </thead>

        <tbody>
          {alarms.map((alarm) => (
            <tr key={alarm._id}>
              <td>{alarm.clientName}</td>
              <td>{alarm.siteName}</td>
              <td>{alarm.equipmentName}</td>
              <td>{alarm.alarmName}</td>
              <td>{alarm.category}</td>
              <td>{alarm.priority}</td>
              <td>{alarm.state}</td>
              <td>{new Date(alarm.occurredAt).toLocaleString()}</td>
              <td>{alarm.serviceIssueStatus || "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default LiveAlarms;
