# ⚡ Discord Electricity Price Bot (Graph Version)

A minimal Discord bot that posts **daily Finnish electricity spot prices** as a **15-minute resolution graph**.

Prices are fetched from `api.spot-hinta.fi` (`/dayForward`), converted to **c/kWh (incl. tax)**, rendered as a PNG, and sent to a Discord channel once per day.

---

## ✨ Features

- 📈 Daily **price curve graph** (PNG)
- ⏱️ 15-minute resolution (96 points)
- 💶 Prices in **c/kWh (incl. VAT)**
- 🌙 Dark, non-transparent background (Discord-friendly)
- 🕑 Designed to run via **cron** after prices are published
- ❌ No scraping, uses JSON API

---

## 📊 Data Source

- **API:** https://api.spot-hinta.fi/dayForward  
- Region: Finland  
- Publication time: ~14:15–14:30 EET (next day prices)

---

## 🧰 Tech Stack

- Node.js 18+
- discord.js
- chart.js
- chartjs-node-canvas
- dotenv

---

## 🚀 Setup

### 1️⃣ Clone & install
```bash
git clone https://github.com/YOUR_USERNAME/discord-electricity-bot.git
cd discord-electricity-bot
npm install
cp .env.template .env
# Configure envs and invite a bot into you server
npm start
