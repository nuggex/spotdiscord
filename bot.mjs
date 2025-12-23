import "dotenv/config";
import fetch from "node-fetch";
import {Client, GatewayIntentBits} from "discord.js";
import {ChartJSNodeCanvas} from "chartjs-node-canvas";
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

async function generateBandGraph(data, date) {
    const hourly = toHourlyBands(data);
    const dailyAvg =
        hourly.reduce((sum, h) => sum + h.avg, 0) / hourly.length;

    const labels = hourly.map(h => h.hour);
    const mins = hourly.map(h => h.min);
    const maxes = hourly.map(h => h.max);
    const avgs = hourly.map(h => +h.avg.toFixed(2));

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
            }
        }],
        options: {
            plugins: {
                legend: {display: false},
                title: {
                    display: true,
                    text: `Electricity prices ${date} · hourly min/max + avg`,
                    color: "#e5e7eb"
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#cbd5e1",
                        callback: (value, index) => {
                            // labels[index] is "HH:00" → extract HH
                            return configuration.data.labels[index].slice(0, 2);
                        }
                    },
                    grid: {color: "#334155"}
                },
                y: {
                    ticks: {color: "#cbd5e1"},
                    grid: {color: "#334155"},
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
                legend: {display: false},
                title: {
                    display: true,
                    text: `Electricity prices ${date} · 15 min resolution`,
                    color: "#e5e7eb"
                }
            },
            scales: {
                x: {
                    ticks: {color: "#cbd5e1", maxTicksLimit: 24},
                    grid: {color: "#334155"}
                },
                y: {
                    ticks: {color: "#cbd5e1"},
                    grid: {color: "#334155"},
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
    fs.writeFileSync("tmp/prices.png", buffer);
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
        content: `📈 ${date} Spot prices` ,
        files: ["/tmp/prices.png"]
    });
    process.exit(0);
}

client.once("ready", postDaily);
client.login(TOKEN);
