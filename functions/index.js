const functions = require("firebase-functions");
const admin = require('firebase-admin');
const {Telegraf} = require("telegraf");
const axios = require("axios");
require('dotenv').config();

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const FUNCTION_URL = process.env.FUNCTION_URL;
const bot = new Telegraf(BOT_TOKEN);
const db = admin.firestore();

if (!BOT_TOKEN || !FUNCTION_URL) {
  throw new Error('Environment variables TELEGRAM_TOKEN and FUNCTION_URL must be set');
}

bot.telegram.setWebhook(`${FUNCTION_URL}/telegrambot`)
  .then(() => console.log('Webhook set successfully'))
  .catch(error => console.error('Webhook setting failed:', error));

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
});
  
bot.catch((err, ctx) => {
  console.error('[Bot Error]', err);
  ctx.reply('An error occurred, please try again later');
});

bot.command("add", async (ctx) => {
  try {
    const username = ctx.message.text.split(" ")[1];
    if (!username) {
      return ctx.reply("Usage: /add <LeetCode Username>");
    }

    const chatId = ctx.chat.id;
    const chatRef = db.collection('chats').doc(chatId.toString());

    const doc = await chatRef.get();
    const usernames = doc.exists ? doc.data().usernames || [] : [];

    // Check if username already exists
    if (usernames.includes(username)) {
      return ctx.reply(`Username '${username}' is already added!`);
    }

    // Add new username to array
    usernames.push(username);
    await chatRef.set({ usernames }, { merge: true });

    ctx.reply(`Username '${username}' added! Total usernames in chat: ${usernames.length}`);
  } catch (error) {
    console.error('[Add] Error:', error);
    ctx.reply("Error adding username. Please try again.");
  }
});

bot.command("list", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const chatRef = db.collection('chats').doc(chatId.toString());
    
    const doc = await chatRef.get();
    const usernames = doc.exists ? doc.data().usernames || [] : [];

    if (usernames.length === 0) {
      return ctx.reply("No usernames added yet. Use /add <username> to add LeetCode users.");
    }

    const usernameList = usernames
      .map((username, index) => `${index + 1}. ${username}`)
      .join('\n');

    ctx.reply(`📋 LeetCode usernames in this chat:\n${usernameList}`);
  } catch (error) {
    console.error('[List] Error:', error);
    ctx.reply("Error listing usernames. Please try again.");
  }
});

bot.command("leaderboard", async (ctx) => {
  try {
    console.log('[Leaderboard] Starting leaderboard generation');
    
    const chatId = ctx.chat.id;
    const chatRef = db.collection('chats').doc(chatId.toString());
    
    const doc = await chatRef.get();
    const usernames = doc.exists ? doc.data().usernames || [] : [];

    if (usernames.length === 0) {
      return ctx.reply("No users added yet. Use /add <username> to add LeetCode users.");
    }

    const leaderboard = [];
    for (const username of usernames) {
      try {
        const userData = await fetchLeetcodeData(username);
        const userStats = userData.data.matchedUser.userCalendar;
        
        leaderboard.push({ 
          username, 
          streak: userStats.streak,
          totalActiveDays: userStats.totalActiveDays
        });
      } catch (error) {
        console.error(`[Leaderboard] Error processing user ${username}:`, error);
      }
    }

    if (leaderboard.length === 0) {
      return ctx.reply("Could not fetch data for any users.");
    }

    leaderboard.sort((a, b) => b.streak - a.streak);
    const leaderboardText = leaderboard
      .map((entry, index) => 
        `${index + 1}. ${entry.username}: 🔥 ${entry.streak} day streak (${entry.totalActiveDays} total active days)`)
      .join("\n");

    await ctx.reply(`🏆 LeetCode Streak Leaderboard:\n\n${leaderboardText}`);
  } catch (error) {
    console.error('[Leaderboard] Command error:', error);
    ctx.reply("Error generating leaderboard. Please try again later.");
  }
});

async function fetchLeetcodeData(username) {
  const url = "https://leetcode.com/graphql";
  try {
    console.log(`[Fetch] Attempting to fetch data for user: ${username}`);
    
    const currentYear = new Date().getFullYear();
    const query = {
      query: `
        query userProfileCalendar($username: String!, $year: Int) {
          matchedUser(username: $username) {
            userCalendar(year: $year) {
              activeYears
              streak
              totalActiveDays
              submissionCalendar
            }
          }
        }
      `,
      variables: { 
        username,
        year: currentYear
      },
    };

    const response = await axios.post(url, query, {
      headers: {"Content-Type": "application/json"},
    });

    console.log(`[Fetch] Response for ${username}:`, JSON.stringify(response.data, null, 2));

    if (!response.data.data || !response.data.data.matchedUser) {
      throw new Error(`User ${username} not found`);
    }

    return response.data;
  } catch (error) {
    console.error(`[Fetch] Error for ${username}:`, error.message);
    throw error;
  }
}

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
