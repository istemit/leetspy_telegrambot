const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Telegraf } = require("telegraf");
const axios = require("axios");
require("dotenv").config();

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const FUNCTION_URL = process.env.FUNCTION_URL;
const bot = new Telegraf(BOT_TOKEN);
const db = admin.firestore();

if (!BOT_TOKEN || !FUNCTION_URL) {
  throw new Error(
    "Environment variables TELEGRAM_TOKEN and FUNCTION_URL must be set"
  );
}

bot.telegram
  .setWebhook(`${FUNCTION_URL}/telegrambot`)
  .then(() => console.log("Webhook set successfully"))
  .catch((error) => console.error("Webhook setting failed:", error));

bot.start(async (ctx) => {
  try {
    console.log("[Bot Start] New user:", ctx.from.id);
    await ctx.reply(
      "Welcome to the LeetCode Leaderboard Bot! " +
        "Use /add <username> to add your LeetCode username."
    );
    console.log("[Bot Start] Welcome message sent");
  } catch (error) {
    console.error("[Bot Start Error]:", error);
    throw error; // Let the global error handler catch it
  }
});

bot.catch((err, ctx) => {
  console.error("[Bot Error]", err);
  ctx.reply("An error occurred, please try again later");
});

bot.command("add", async (ctx) => {
  try {
    const username = ctx.message.text.split(" ")[1];
    if (!username) {
      return ctx.reply("Usage: /add <LeetCode Username>");
    }

    const isValid = await verifyLeetCodeUser(username);

    if (!isValid) {
      return ctx.reply(`Username '${username}' not found on LeetCode!`);
    }

    const chatId = ctx.chat.id;
    const chatRef = db.collection("chats").doc(chatId.toString());

    const doc = await chatRef.get();
    const usernames = doc.exists ? doc.data().usernames || [] : [];

    // Check if username already exists
    if (usernames.includes(username)) {
      return ctx.reply(`Username '${username}' is already added!`);
    }

    // Add new username to array
    usernames.push(username);
    await chatRef.set({ usernames }, { merge: true });

    ctx.reply(
      `✅ Username '${username}' verified and added! Total usernames in chat: ${usernames.length}`
    );
  } catch (error) {
    console.error("[Add] Error:", error);
    ctx.reply("Error adding username. Please try again.");
  }
});

bot.command("list", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const chatRef = db.collection("chats").doc(chatId.toString());

    const doc = await chatRef.get();
    const usernames = doc.exists ? doc.data().usernames || [] : [];

    if (usernames.length === 0) {
      return ctx.reply(
        "No usernames added yet. Use /add <username> to add LeetCode users."
      );
    }

    const usernameList = usernames
      .map((username, index) => `${index + 1}. ${username}`)
      .join("\n");

    ctx.reply(`📋 LeetCode usernames in this chat:\n${usernameList}`);
  } catch (error) {
    console.error("[List] Error:", error);
    ctx.reply("Error listing usernames. Please try again.");
  }
});

bot.command("leaderboard", async (ctx) => {
  try {
    console.log("[Leaderboard] Starting leaderboard generation");

    const chatId = ctx.chat.id;
    const chatRef = db.collection("chats").doc(chatId.toString());

    const doc = await chatRef.get();
    const usernames = doc.exists ? doc.data().usernames || [] : [];

    if (usernames.length === 0) {
      return ctx.reply(
        "No users added yet. Use /add <username> to add LeetCode users."
      );
    }

    const leaderboard = [];
    for (const username of usernames) {
      try {
        const userData = await fetchLeetcodeData(username);
        const userStats = userData.data.matchedUser.userCalendar;
        const currentStreak = await calculateCurrentStreak(
          userStats.submissionCalendar
        );

        leaderboard.push({
          username,
          currentStreak,
          maxStreak: userStats.streak,
          totalActiveDays: userStats.totalActiveDays,
        });
      } catch (error) {
        console.error(
          `[Leaderboard] Error processing user ${username}:`,
          error
        );
      }
    }

    if (leaderboard.length === 0) {
      return ctx.reply("Could not fetch data for any users.");
    }

    leaderboard.sort((a, b) => b.currentStreak - a.currentStreak);
    const leaderboardText = leaderboard
      .map(
        (entry, index) =>
          `${index + 1}. <a href="https://leetcode.com/u/${entry.username}/">${
            entry.username
          }</a>: 🔥 ${entry.currentStreak} current streak (max: ${
            entry.maxStreak
          })`
      )
      .join("\n");

    await ctx.reply(`🏆 LeetCode Streak Leaderboard:\n\n${leaderboardText}`, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error("[Leaderboard] Command error:", error);
    ctx.reply("Error generating leaderboard. Please try again later.");
  }
});

bot.command("remove", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const chatRef = db.collection("chats").doc(chatId.toString());
    
    const doc = await chatRef.get();
    const usernames = doc.exists ? doc.data().usernames || [] : [];

    if (usernames.length === 0) {
      return ctx.reply("No users to remove. Use /add to add users first.");
    }

    const keyboard = [
      ...usernames.map(username => [{
        text: `❌ ${username}`,
        callback_data: `remove:${username}`
      }]),
      [{ text: "Cancel", callback_data: "remove:cancel" }]
    ];

    await ctx.reply("Select user to remove:", {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    console.error("[Remove] Error:", error);
    ctx.reply("Error loading users. Please try again.");
  }
});

bot.action("remove:cancel", async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    console.error("[Remove] Cancel error:", error);
  }
});

bot.action(/remove:(.+)/, async (ctx) => {
  try {
    const username = ctx.match[1];
    const chatId = ctx.chat.id;
    const chatRef = db.collection("chats").doc(chatId.toString());
    
    const doc = await chatRef.get();
    const usernames = doc.exists ? doc.data().usernames || [] : [];
    
    const updatedUsernames = usernames.filter(u => u !== username);
    await chatRef.set({ usernames: updatedUsernames }, { merge: true });
    
    await ctx.editMessageText(`✅ Removed ${username} from the list.`);
  } catch (error) {
    console.error("[Remove] Callback error:", error);
    ctx.answerCbQuery("Error removing user.");
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
        year: currentYear,
      },
    };

    const response = await axios.post(url, query);
    const userCalendar = response.data.data.matchedUser.userCalendar;

    const currentStreak = await calculateCurrentStreak(
      userCalendar.submissionCalendar
    );

    return {
      data: {
        matchedUser: {
          userCalendar: {
            ...userCalendar,
            currentStreak,
            maxStreak: userCalendar.streak,
          },
        },
      },
    };
  } catch (error) {
    console.error(`[Fetch] Error for ${username}:`, error.message);
    throw error;
  }
}

async function calculateCurrentStreak(submissionCalendar) {
  const submissions = JSON.parse(submissionCalendar);

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const today = Math.floor(now.getTime() / 1000);
  const yesterday = today - 86400;
  const oneDay = 86400;

  let currentStreak = 0;
  let currentDay = today;
  const maxDays = 365;
  let daysChecked = 0;

  // If no submissions today, start checking from yesterday
  if (
    !submissions[today.toString()] ||
    parseInt(submissions[today.toString()]) === 0
  ) {
    currentDay = yesterday;
    console.log("[Streak] No submissions today, checking from yesterday");
  }

  while (daysChecked < maxDays) {
    const dayKey = currentDay.toString();
    if (submissions[dayKey] && parseInt(submissions[dayKey]) > 0) {
      currentStreak++;
      currentDay -= oneDay;
      daysChecked++;
    } else {
      break;
    }
  }

  return currentStreak;
}

async function verifyLeetCodeUser(username) {
  const url = "https://leetcode.com/graphql";
  try {
    const query = {
      query: `
        query getUserProfile($username: String!) {
          matchedUser(username: $username) {
            username
          }
        }
      `,
      variables: { username },
    };

    const response = await axios.post(url, query);
    return response.data.data.matchedUser !== null;
  } catch (error) {
    console.error(`[Verify] Error checking user ${username}:`, error);
    return false;
  }
}

exports.telegrambot = functions.https.onRequest(async (req, res) => {
  try {
    console.log("[Webhook] Received update:", req.body);
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("[Webhook Error]:", error);
    res.sendStatus(500);
  }
});
