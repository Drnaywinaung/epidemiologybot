// Load environment variables
require('dotenv').config();
console.log('Loaded .env file');

// Import libraries
const { Telegraf } = require('telegraf');
const express = require('express');

// --- Configuration ---
const token = process.env.TELEGRAM_BOT_TOKEN;
console.log('TELEGRAM_BOT_TOKEN:', token ? 'Set' : 'Not set');
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN is not defined.");
    process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';
console.log('Environment:', isProduction ? 'Production' : 'Development');

// Initialize Express app
const app = express();
app.use(express.json());
console.log('Express app initialized');

// Webhook path
const webhookPath = `/bot${token}`;

// --- Bot Setup ---
let bot;

if (isProduction) {
    const webHookUrl = process.env.WEBHOOK_URL;
    console.log('WEBHOOK_URL:', webHookUrl || 'Not set');
    if (!webHookUrl) {
        console.error("FATAL ERROR: WEBHOOK_URL must be set for production.");
        process.exit(1);
    }

    const fullWebhookUrl = `${webHookUrl}${webhookPath}`;
    bot = new Telegraf(token);
    app.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(fullWebhookUrl, { drop_pending_updates: true })
        .then(() => console.log(`Webhook set to ${fullWebhookUrl}`))
        .catch(err => console.error(`Failed to set webhook: ${err.message}`));
} else {
    bot = new Telegraf(token);
    bot.launch()
        .then(() => console.log('Epidemiology Bot started with polling...'))
        .catch(err => console.error(`Failed to start polling: ${err.message}`));
}

console.log('Epidemiology Bot server started...');

// Catch Telegraf errors
bot.catch((err, ctx) => {
    console.error(`Telegraf error: ${err.message}`, err);
});

// --- Health Check ---
app.get('/', (req, res) => {
    console.log('Health check accessed');
    res.send('Bot server is running!');
});

// --- Safe Message Sending ---
async function sendTelegramMessageSafely(chatId, text, botInstance, options = {}) {
    const MAX_MESSAGE_LENGTH = 4096;
    console.log(`Sending message to chat ${chatId}: ${text.slice(0, 50)}...`);
    try {
        if (text.length <= MAX_MESSAGE_LENGTH) {
            await botInstance.telegram.sendMessage(chatId, text, options);
        } else {
            let startIndex = 0;
            while (startIndex < text.length) {
                const endIndex = Math.min(startIndex + MAX_MESSAGE_LENGTH, text.length);
                const chunk = text.substring(startIndex, endIndex);
                await botInstance.telegram.sendMessage(chatId, chunk, options);
                startIndex = endIndex;
            }
        }
    } catch (err) {
        console.error(`Failed to send message to ${chatId}: ${err.message}`);
    }
}

// Load knowledge base
let KNOWLEDGE_BASE;
try {
    KNOWLEDGE_BASE = require('./knowledgeBase.js');
    console.log('Knowledge base loaded:', Object.keys(KNOWLEDGE_BASE).length, 'terms');
} catch (err) {
    console.error('Failed to load knowledgeBase.js:', err.message);
    process.exit(1);
}

// --- Bot Commands ---
bot.command(['start', 'help'], async (ctx) => {
    const chatId = ctx.chat.id;
    const userName = ctx.from.first_name;
    const availableTopics = Object.keys(KNOWLEDGE_BASE).sort().join(', ');
    const welcomeMessage = `Hello, ${userName}! 👋\n\nI am a bot with knowledge from a glossary of epidemiology terms.\n\nYou can ask me to define any of the following topics:\n• ${availableTopics}`;
    await sendTelegramMessageSafely(chatId, welcomeMessage, bot);
});

// --- Message Handler ---
bot.on('message', async (ctx) => {
    const userMessage = ctx.message.text?.trim().toLowerCase();
    if (!userMessage || userMessage.startsWith('/')) return;

    const chatId = ctx.chat.id;
    console.log(`Received message from ${chatId}: ${userMessage}`);

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

// Handle termination
process.once('SIGINT', () => {
    console.log('Stopping bot...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('Stopping bot...');
    bot.stop('SIGTERM');
});