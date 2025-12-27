import "dotenv/config";
import fetch from "node-fetch";
import {Client, GatewayIntentBits} from "discord.js";
import {ChartJSNodeCanvas} from "chartjs-node-canvas";
import fs from "fs";
import {color} from "chart.js/helpers";

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
const chartCanvas = new ChartJSNodeCanvas({width: WIDTH, height: HEIGHT});

function toHourlyBands(data) {
    const buckets = {};

    // 1) Bucket incoming data by Finland-local hour
    for (const p of data) {
        const d = new Date(p.DateTime);

        const parts = new Intl.DateTimeFormat("fi-FI", {
            timeZone: "Europe/Helsinki",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            hour12: false
        }).formatToParts(d);

        const get = t => parts.find(p => p.type === t).value;
        const hourKey = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}`;

        const price = p.PriceWithTax * 100;

        if (!buckets[hourKey]) buckets[hourKey] = [];
        buckets[hourKey].push(price);
    }

    // 2) Determine the date we’re working on (Finland-local)
    const first = new Date(data[0].DateTime);
    const baseDate = new Intl.DateTimeFormat("fi-FI", {
        timeZone: "Europe/Helsinki",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    })
        .formatToParts(first)
        .reduce((acc, p) => {
            acc[p.type] = p.value;
            return acc;
        }, {});

    const yyyy = baseDate.year;
    const mm = baseDate.month;
    const dd = baseDate.day;

    // 3) Build exactly 24 hours: 00 → 23
    const result = [];

    for (let h = 0; h <= 24; h++) {
        const hh = String(h).padStart(2, "0");
        const key = `${yyyy}-${mm}-${dd}T${hh}`;
        const prices = buckets[key];

        if (prices && prices.length) {
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

            result.push({
                hour: hh,
                min,
                max,
                avg
            });
        } else {
            // Missing hour → carry forward last known value (or null)
            const prev = result[result.length - 1];
            result.push({
                hour: hh,
                min: prev ? prev.min : null,
                max: prev ? prev.max : null,
                avg: prev ? prev.avg : null
            });
        }
    }

    return result;
}

function computeDailyStats(data) {
    const prices = data.map(p => p.PriceWithTax * 100).sort((a, b) => a - b);

    const min = prices[0];
    const max = prices[prices.length - 1];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    const mid = Math.floor(prices.length / 2);
    const median =
        prices.length % 2 === 0
            ? (prices[mid - 1] + prices[mid]) / 2
            : prices[mid];

    return {min, max, avg, median};
}

function formatFinnishDate(isoDate) {
    const d = new Date(isoDate);
    return new Intl.DateTimeFormat("fi-FI", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Europe/Helsinki"
    }).format(d);
}

function fixZero(value) {
    return Math.abs(value) < 0.005 ? 0 : value;
}

const headerPlugin = (date, stats) => ({
    id: "customHeader",
    beforeDraw: chart => {
        const {ctx, width} = chart;

        ctx.save();

        const titleText = `⚡ SPOT ${formatFinnishDate(date)} ⚡`;
        const titleY = 30;

        ctx.save();
        ctx.font = "bold 32px sans-serif";
        ctx.textAlign = "center";

        // Create horizontal electric gradient
        const textWidth = ctx.measureText(titleText).width;
        const x0 = width / 2 - textWidth / 2;
        const x1 = width / 2 + textWidth / 2;

        const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
        gradient.addColorStop(0.0, "#00e5ff"); // electric blue
        gradient.addColorStop(0.5, "#00ff88"); // neon green
        gradient.addColorStop(1.0, "#38bdf8"); // cyan-blue

        ctx.fillStyle = gradient;
        ctx.fillText(titleText, width / 2, titleY);
        ctx.restore();

        // ===== STATS =====
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";

        const y = 56;
        let x = width / 2;

        // spacing control
        const gap = 18;


        // Calculate stats text
        const minText = `▼ Min ${fixZero(stats.min).toFixed(2)} c/kWh   `;
        const maxText = `▲ Max  ${fixZero(stats.max).toFixed(2)} c/kWh   `;
        const avgText = `📊 Avg ${fixZero(stats.avg).toFixed(2)} c/kWh   `;
        const medText = `⚖️ Median ${fixZero(stats.median).toFixed(2)} c/kWh`;
        // Measure widths for proper centering

        const w1 = ctx.measureText(minText).width;
        const w2 = ctx.measureText(maxText).width;
        const w3 = ctx.measureText(avgText).width;
        const w4 = ctx.measureText(medText).width;
        const totalWidth = w1 + w2 + w3 + w4 + gap * 3;
        let startX = width / 2 - totalWidth / 2;
        // Draw stats
        ctx.fillStyle = "#00ff88"; // green
        ctx.fillText(minText, startX + w1 / 2, y);
        startX += w1 + gap;

        ctx.fillStyle = "#ff4747"; // red
        ctx.fillText(maxText, startX + w2 / 2, y);
        startX += w2 + gap;

        ctx.fillStyle = "#facc15"; // yellow
        ctx.fillText(avgText, startX + w3 / 2, y);
        startX += w3 + gap;

        ctx.fillStyle = "#fb923c"; // orange
        ctx.fillText(medText, startX + w4 / 2, y);

        ctx.restore();
    }
});

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
    return `rgb(
    ${Math.round(lerp(c1[0], c2[0], t))},
    ${Math.round(lerp(c1[1], c2[1], t))},
    ${Math.round(lerp(c1[2], c2[2], t))}
  )`;
}

async function generateBandGraph(data, date) {
    const hourly = toHourlyBands(data);
    const dailyAvg =
        hourly.reduce((sum, h) => sum + h.avg, 0) / hourly.length;
    const {min, max, avg, median} = computeDailyStats(data);
    const stats = computeDailyStats(data);

    const labels = hourly.map(h => h.hour);
    const mins = hourly.map(h => h.min);
    const maxes = hourly.map(h => h.max);
    const avgs = hourly.map(h => +h.avg.toFixed(2));
    const minVal = Math.min(...hourly.map(h => h.avg));
    const maxVal = Math.max(...hourly.map(h => h.avg));

    const configuration = {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Max",
                    data: maxes,
                    borderWidth: 0,
                    pointRadius: 0,
                    fill: "+1",
                    backgroundColor: (ctx) => {
                        const chart = ctx.chart;

                        // SAFETY GUARD — absolutely required
                        if (!chart || !chart.ctx || !chart.scales || !chart.scales.y) {
                            return "rgba(56, 189, 248, 0.25)"; // safe fallback
                        }

                        const canvas = chart.ctx;
                        const y = chart.scales.y;

                        const avgY = y.getPixelForValue(dailyAvg);

                        // Another guard: scale not laid out yet
                        if (!Number.isFinite(avgY)) {
                            return "rgba(56, 189, 248, 0.25)";
                        }

                        const gradient = canvas.createLinearGradient(0, y.top, 0, y.bottom);

                        // Red (expensive)
                        gradient.addColorStop(0, "rgba(255, 71, 71, 0.45)");

                        // Neutral around average
                        const stop = (avgY - y.top) / (y.bottom - y.top);
                        gradient.addColorStop(
                            Math.max(0, Math.min(1, stop)),
                            "rgba(148, 163, 184, 0.25)"
                        );

                        // Green (cheap)
                        gradient.addColorStop(1, "rgba(0, 255, 136, 0.45)");

                        return gradient;
                    }

                },
                {
                    label: "Min",
                    data: mins,
                    borderWidth: 0,
                    pointRadius: 0,
                    fill: true
                },
                {
                    label: "Average",
                    data: avgs,
                    borderColor: "#38bdf8",
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.3
                }
            ]
        },
        plugins: [{
            id: "background",
            beforeDraw: chart => {
                const ctx = chart.ctx;
                ctx.save();
                ctx.fillStyle = "#0f172a";
                ctx.fillRect(0, 0, chart.width, chart.height);
                ctx.restore();
            },
        },
            headerPlugin(date, stats),
        ],
        options: {
            plugins: {
                legend: {display: false},
                title: {
                    display: true,
                    color: "#e5e7eb",
                    padding: {
                        top: 30,
                        bottom: 30
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#cbd5e1",
                        font: {size: 14},
                        callback: (value, index) => {
                            // labels[index] is "HH:00" → extract HH
                            return configuration.data.labels[index].slice(0, 2);
                        }

                    },
                    grid: {color: "#334155"}
                },
                y: {
                    ticks: {color: "#cbd5e1", font: {size: 16}},
                    grid: {color: "#334155"},
                    title: {
                        display: true,
                        text: "c/kWh",
                        font: {size: 16},
                        color: "#e5e7eb"
                    }
                }
            },


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

    await generateBandGraph(data, date);

    if (process.env.TEST_MODE === "true") {
        console.log("Graph saved to /tmp/prices.png");
        process.exit(0);
    }

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send({
        content: `📈 ${formatFinnishDate(date)} Spot prices`,
        files: ["/tmp/prices.png"]
    });
    process.exit(0);
}

client.once("ready", postDaily);
client.login(TOKEN);
