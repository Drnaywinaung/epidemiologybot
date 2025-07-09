// Load environment variables for local development
require('dotenv').config();

// Import necessary libraries
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// --- Configuration ---
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN is not defined.");
    process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';

// Initialize Express app
const app = express();
app.use(express.json()); // Essential for parsing incoming Telegram updates

// Define the base path for your webhook that the bot library expects
// This is typically '/bot' followed by the token
const webhookBase = `/bot${token}`; 

// --- Bot Setup ---
let bot;

if (isProduction) {
    const webHookUrl = process.env.WEBHOOK_URL; // This should be just your Railway domain, e.g., https://your-app.up.railway.app
    if (!webHookUrl) {
        console.error("FATAL ERROR: WEBHOOK_URL must be set for production.");
        process.exit(1);
    }
    
    const fullWebhookUrl = `${webHookUrl}${webhookBase}`; // Full URL Telegram will call

    // Initialize bot with webhook options
    bot = new TelegramBot(token, {
        webHook: {
            port: process.env.PORT, // Railway's assigned port
            host: '0.0.0.0', // Listen on all interfaces
            autoSsl: true // Use true if Railway provides SSL
        }
    });

    // Set the webhook for Telegram
    bot.setWebHook(fullWebhookUrl, {
        drop_pending_updates: true // Good practice to drop old updates on redeploy
    });
    console.log(`Webhook set to ${fullWebhookUrl}`);

    // Link TelegramBot to Express app. This is the crucial part.
    // The webhookBase (e.g., /bot<token>) is the path that bot.webhookCallback expects
    // the incoming POST requests to be on.
    app.use(bot.webhookCallback(webhookBase)); 
    
} else {
    // Local development: polling
    bot = new TelegramBot(token, { polling: true });
}

console.log('Epidemiology Bot server started...');

// --- Health Check Endpoint (Optional but Recommended) ---
// This will respond to GET requests at your Railway domain root
app.get('/', (req, res) => {
    res.send('Bot server is running!');
});

/**
 * Sends a Telegram message, splitting it into chunks if it exceeds the maximum length.
 * ... (rest of your sendTelegramMessageSafely function)
 */
async function sendTelegramMessageSafely(chatId, text, botInstance, options = {}) {
    const MAX_MESSAGE_LENGTH = 4096; // Telegram's max for regular text messages

    if (text.length <= MAX_MESSAGE_LENGTH) {
        await botInstance.sendMessage(chatId, text, options);
    } else {
        let startIndex = 0;
        while (startIndex < text.length) {
            const endIndex = Math.min(startIndex + MAX_MESSAGE_LENGTH, text.length);
            const chunk = text.substring(startIndex, endIndex);
            await botInstance.sendMessage(chatId, chunk, options);
            startIndex = endIndex;
        }
    }
}


// --- Bot Command Handlers ---
// ... (Your existing bot.onText and bot.on('message') handlers)
bot.onText(/\/start|\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name;
    const availableTopics = Object.keys(KNOWLEDGE_BASE).sort().join(', ');
    const welcomeMessage = `Hello, ${userName}! 👋\n\nI am a bot with knowledge from a glossary of epidemiology terms.\n\nYou can ask me to define any of the following topics:\n• ${availableTopics}`;
    await sendTelegramMessageSafely(chatId, welcomeMessage, bot);
});

bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // Ignore commands

    const chatId = msg.chat.id;
    const userMessage = msg.text.trim().toLowerCase();

    const termMatches = Object.keys(KNOWLEDGE_BASE).filter(keyword =>
        keyword.toLowerCase().includes(userMessage)
    );

    if (termMatches.length > 0) {
        for (const keyword of termMatches.slice(0, 5)) {
            await sendTelegramMessageSafely(chatId, KNOWLEDGE_BASE[keyword], bot, { parse_mode: 'Markdown' });
        }
        return;
    }

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
        for (const match of definitionMatches.slice(0, 5)) {
            await sendTelegramMessageSafely(chatId, KNOWLEDGE_BASE[match.keyword], bot, { parse_mode: 'Markdown' });
        }
    } else {
        await sendTelegramMessageSafely(chatId, "I'm sorry, I don't have information on that topic. Please try asking about one of the keywords mentioned in /help.", bot);
    }
});


// --- Server Listener ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));