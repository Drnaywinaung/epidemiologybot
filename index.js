// Load environment variables for local development
require('dotenv').config();

// Import necessary libraries
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const KNOWLEDGE_BASE = require('./knowledgeBase.js');

// --- Configuration ---
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN is not defined.");
    process.exit(1);
}

// --- Bot Setup ---
// Use webhooks for production (on Render) and polling for local development
const isProduction = process.env.NODE_ENV === 'production';
const bot = isProduction ? new TelegramBot(token) : new TelegramBot(token, { polling: true });

// Setup Webhook for Render
if (isProduction) {
    const webHookUrl = process.env.WEBHOOK_URL;
    if (!webHookUrl) {
        console.error("FATAL ERROR: WEBHOOK_URL must be set for production.");
        process.exit(1);
    }
    const fullWebhook = `${webHookUrl}/api/webhook/${token}`;
    bot.setWebHook(fullWebhook);
    console.log(`Webhook set to ${fullWebhook}`);
}

console.log('Epidemiology Bot server started...');

/**
 * Sends a Telegram message, splitting it into chunks if it exceeds the maximum length.
 * @param {number} chatId - The ID of the chat to send the message to.
 * @param {string} text - The text content of the message.
 * @param {object} botInstance - The TelegramBot instance.
 * @param {object} [options] - Optional parameters for the message (e.g., parse_mode).
 */
async function sendTelegramMessageSafely(chatId, text, botInstance, options = {}) {
    const MAX_MESSAGE_LENGTH = 4096; // Telegram's max for regular text messages

    if (text.length <= MAX_MESSAGE_LENGTH) {
        await botInstance.sendMessage(chatId, text, options);
    } else {
        // Split the text into chunks
        let startIndex = 0;
        while (startIndex < text.length) {
            const endIndex = Math.min(startIndex + MAX_MESSAGE_LENGTH, text.length);
            const chunk = text.substring(startIndex, endIndex);

            // Send each chunk
            await botInstance.sendMessage(chatId, chunk, options);

            // Optional: Add a small delay between sending chunks to avoid potential rate limits
            // For very large messages or frequent sends, consider uncommenting this.
            // await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay

            startIndex = endIndex;
        }
    }
}


// --- Bot Command Handlers ---
bot.onText(/\/start|\/help/, async (msg) => { // Made async to use await with sendTelegramMessageSafely
    const chatId = msg.chat.id;
    const userName = msg.from.first_name;
    const availableTopics = Object.keys(KNOWLEDGE_BASE).sort().join(', ');
    const welcomeMessage = `Hello, ${userName}! 👋\n\nI am a bot with knowledge from a glossary of epidemiology terms.\n\nYou can ask me to define any of the following topics:\n• ${availableTopics}`;
    
    // Use the safe function for sending messages
    await sendTelegramMessageSafely(chatId, welcomeMessage, bot);
});

// --- Main Message Handler with Search Logic ---
bot.on('message', async (msg) => { // Made async to use await with sendTelegramMessageSafely
    if (msg.text && msg.text.startsWith('/')) return; // Ignore commands

    const chatId = msg.chat.id;
    const userMessage = msg.text.trim().toLowerCase();

    // Step 1: Prioritize searching within the terms (keywords)
    const termMatches = Object.keys(KNOWLEDGE_BASE).filter(keyword =>
        keyword.toLowerCase().includes(userMessage)
    );

    if (termMatches.length > 0) {
        // Limit to 5 matches to avoid overwhelming the user
        for (const keyword of termMatches.slice(0, 5)) {
            // Use the safe function for sending messages
            await sendTelegramMessageSafely(chatId, KNOWLEDGE_BASE[keyword], bot, { parse_mode: 'Markdown' });
        }
        return;
    }

    // Step 2: Fallback to searching within definitions
    const searchWords = userMessage.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
    if (searchWords.length === 0) {
        await sendTelegramMessageSafely(chatId, "Please provide some keywords to search for.", bot);
        return;
    }
    
    const definitionMatches = [];
    for (const keyword in KNOWLEDGE_BASE) {
        const definition = KNOWLEDGE_BASE[keyword];
        const score = searchWords.filter(word => definition.toLowerCase().includes(word)).length;
        if (score > 0) {
            definitionMatches.push({ keyword, score });
        }
    }

    if (definitionMatches.length > 0) {
        definitionMatches.sort((a, b) => b.score - a.score);
        // Limit to 5 matches
        for (const match of definitionMatches.slice(0, 5)) {
            // Use the safe function for sending messages
            await sendTelegramMessageSafely(chatId, KNOWLEDGE_BASE[match.keyword], bot, { parse_mode: 'Markdown' });
        }
    } else {
        await sendTelegramMessageSafely(chatId, "I'm sorry, I don't have information on that topic. Please try asking about one of the keywords mentioned in /help.", bot);
    }
});

// --- Webhook Server (for Production on Render) ---
if (isProduction) {
    const app = express();
    app.use(express.json());
    app.get('/', (req, res) => res.send('Bot is live!'));
    app.post(`/api/webhook/${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}
