// /**
//  * Import function triggers from their respective submodules:
//  *
//  * const {onCall} = require("firebase-functions/v2/https");
//  * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
//  *
//  * See a full list of supported triggers at https://firebase.google.com/docs/functions
//  */

// const {onRequest} = require("firebase-functions/v2/https");
// const logger = require("firebase-functions/logger");

// // Create and deploy your first functions
// // https://firebase.google.com/docs/functions/get-started

// // exports.helloWorld = onRequest((request, response) => {
// //   logger.info("Hello logs!", {structuredData: true});
// //   response.send("Hello from Firebase!");
// // });

// const path = require('path');
// const dotenv = require('dotenv');


const functions = require("firebase-functions");
const {Telegraf} = require("telegraf");
const axios = require("axios");
const express = require("express");
require('dotenv').config();

// Load the Telegram bot token from environment variables
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const FUNCTION_URL = process.env.FUNCTION_URL;
const bot = new Telegraf(BOT_TOKEN);

if (!BOT_TOKEN || !FUNCTION_URL) {
  throw new Error('Environment variables TELEGRAM_TOKEN and FUNCTION_URL must be set');
}

bot.catch((err, ctx) => {
  console.error('[Bot Error]', err);
  ctx.reply('An error occurred, please try again later');
});

/**
 * Fetches user data from LeetCode.
 * @param {string} username - The LeetCode username.
 * @return {Promise<Object>} The user's data from LeetCode.
 */
async function fetchLeetcodeData(username) {
  const url = "https://leetcode.com/graphql";
  const query = {
    query: `
      query getUserProfile($username: String!) {
        matchedUser(username: $username) {
          username
          submitStats {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }
    `,
    variables: {username},
  };
  const response = await axios.post(url, query, {
    headers: {"Content-Type": "application/json"},
  });
  return response.data;
}

// Store usernames in memory (replace with Firestore for persistence)
const userMap = new Map();

bot.start(async (ctx) => {
  try {
    console.log('[Bot Start] New user:', ctx.from.id);
    await ctx.reply(
      "Welcome to the LeetCode Leaderboard Bot! " +
      "Use /add <username> to add your LeetCode username."
    );
    console.log('[Bot Start] Welcome message sent');
  } catch (error) {
    console.error('[Bot Start Error]:', error);
    throw error; // Let the global error handler catch it
  }

  // ctx.reply(
  //     "Welcome to the LeetCode Leaderboard Bot! " +
  //     "Use /add <username> to add your LeetCode username.",
  // );
});

bot.command("add", (ctx) => {
  const username = ctx.message.text.split(" ")[1];
  if (!username) {
    ctx.reply("Usage: /add <LeetCode Username>");
    return;
  }
  userMap.set(ctx.chat.id, username);
  ctx.reply(`Username '${username}' added!`);
});

bot.command("leaderboard", async (ctx) => {
  const leaderboard = [];
  for (const [username] of userMap.entries()) {
    const userData = await fetchLeetcodeData(username);
    const problemsSolved =
      userData.data.matchedUser.submitStats.acSubmissionNum.reduce(
          (acc, item) => acc + item.count,
          0,
      );
    leaderboard.push({
      username,
      problemsSolved,
    });
  }
  leaderboard.sort((a, b) => b.problemsSolved - a.problemsSolved);

  const leaderboardText = leaderboard
      .map(
          (entry, index) =>
            `${index + 1}. ${entry.username}: ${
              entry.problemsSolved
            } problems solved`,
      )
      .join("\n");

  ctx.reply(leaderboardText || "No data available.");
});

bot.telegram.setWebhook(`${FUNCTION_URL}/telegrambot`)
  .then(() => console.log('Webhook set successfully'))
  .catch(error => console.error('Webhook setting failed:', error));

// Create Express app to handle requests
const app = express();

// Parse incoming JSON requests
app.use(express.json());

// Set the webhook handler for Telegram
app.post("/", (req, res) => {
  bot.handleUpdate(req.body);
  res.status(200).end();
});

// Export as Firebase Function
exports.telegrambot = functions.https.onRequest(async (req, res) => {
  try {
    console.log('[Webhook] Received update:', req.body);
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('[Webhook Error]:', error);
    res.sendStatus(500);
  }
});
