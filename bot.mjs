import "dotenv/config";
import fetch from "node-fetch";
import { Client, GatewayIntentBits } from "discord.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "fs";

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!TOKEN || !CHANNEL_ID) {
  throw new Error("Missing DISCORD_TOKEN or CHANNEL_ID");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});


const WIDTH = 1000;
const HEIGHT = 500;
const chartCanvas = new ChartJSNodeCanvas({ width: WIDTH, height: HEIGHT });

async function generateGraph(data, date) {
  const labels = data.map(p =>
      new Date(p.DateTime).toLocaleTimeString("fi-FI", {
        hour: "2-digit",
        minute: "2-digit"
      })
  );

  const values = data.map(p => +(p.PriceWithTax * 100).toFixed(2));

  const configuration = {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "c/kWh (incl. tax)",
        data: values,
        tension: 0.25,
        pointRadius: 2,
        borderWidth: 2,
        borderColor: "#4ea1ff"
      }]
    },
    plugins: [{
      id: "background",
      beforeDraw: chart => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = "#0f172a"; // dark blue/gray
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }],
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `Electricity prices ${date} · 15 min resolution`,
          color: "#e5e7eb"
        }
      },
      scales: {
        x: {
          ticks: { color: "#cbd5e1", maxTicksLimit: 24 },
          grid: { color: "#334155" }
        },
        y: {
          ticks: { color: "#cbd5e1" },
          grid: { color: "#334155" },
          title: {
            display: true,
            text: "c/kWh",
            color: "#e5e7eb"
          }
        }
      }
    }
  };


  const buffer = await chartCanvas.renderToBuffer(configuration);
  fs.writeFileSync("/tmp/prices.png", buffer);
}

async function postDaily() {
  const res = await fetch("https://api.spot-hinta.fi/dayForward");

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const text = await res.text();
  if (!text) {
    throw new Error("Empty response from API");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from API");
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No price data available");
  }
  // Sort chronologically
  data.sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime));

  const date = data[0].DateTime.split("T")[0];

  await generateGraph(data, date);

  const channel = await client.channels.fetch(CHANNEL_ID);
  await channel.send({
    content: "📈 Daily electricity price curve",
    files: ["/tmp/prices.png"]
  });

  process.exit(0);
}

client.once("ready", postDaily);
client.login(TOKEN);
