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
app.use(express.json()); // Crucial for parsing Telegram's JSON updates
console.log('Express app initialized');

// Webhook path (derived from your token as Telegram expects)
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

    // Explicitly set the webhook with Telegram
    bot.telegram.setWebhook(fullWebhookUrl, { drop_pending_updates: true })
        .then(() => console.log(`Webhook set to ${fullWebhookUrl}`))
        .catch(err => console.error(`Failed to set webhook: ${err.message}`));

    // **CRITICAL: Handle incoming POST requests to the webhook path**
    // This is where Telegram sends updates.
    app.post(webhookPath, (req, res) => {
        console.log(`[Webhook] Received POST request from Telegram on path: ${webhookPath}`);
        // console.log('[Webhook] Request body:', JSON.stringify(req.body, null, 2)); // Log body for debugging if needed

        // Let Telegraf handle the update. Telegraf's webhookCallback or handleUpdate
        // will process the request body and send the 200 OK response back to Telegram.
        // It's important that this call completes successfully and quickly.
        bot.handleUpdate(req.body, res)
            .then(() => {
                console.log('[Webhook] Telegraf handled update successfully.');
                // Telegraf.handleUpdate already sends the 200 OK response.
                // Do NOT add res.sendStatus(200) here, or you'll get 'Headers already sent'.
            })
            .catch(err => {
                console.error(`[Webhook Error] Error processing update: ${err.message}`, err);
                // If an error occurs BEFORE Telegraf sends the response,
                // you must send an error status back.
                if (!res.headersSent) {
                    res.status(500).send('Internal Server Error');
                }
            });
    });

} else { // Development (polling mode)
    bot = new Telegraf(token);
    bot.launch()
        .then(() => console.log('Epidemiology Bot started with polling...'))
        .catch(err => console.error(`Failed to start polling: ${err.message}`));
}

console.log('Epidemiology Bot server initialized.');

// Catch Telegraf errors (for errors within bot logic, not webhook setup)
bot.catch((err, ctx) => {
    console.error(`[Telegraf] Unhandled error: ${err.message}`, err);
    // You could also reply to the user here for debugging, e.g.:
    // if (ctx && ctx.chat) {
    //     ctx.reply('Oops! An internal error occurred. Please try again later.');
    // }
});

// --- Health Check ---
app.get('/', (req, res) => {
    console.log('[HTTP] Health check accessed');
    res.send('Bot server is running!');
});

// --- Safe Message Sending ---
async function sendTelegramMessageSafely(chatId, text, botInstance, options = {}) {
    const MAX_MESSAGE_LENGTH = 4096;
    console.log(`[Telegram] Attempting to send message to chat ${chatId}: ${text.slice(0, 100)}...`);
    try {
        if (text.length <= MAX_MESSAGE_LENGTH) {
            await botInstance.telegram.sendMessage(chatId, text, options);
            console.log(`[Telegram] Message sent to ${chatId}.`);
        } else {
            let startIndex = 0;
            while (startIndex < text.length) {
                const endIndex = Math.min(startIndex + MAX_MESSAGE_LENGTH, text.length);
                const chunk = text.substring(startIndex, endIndex);
                await botInstance.telegram.sendMessage(chatId, chunk, options);
                startIndex = endIndex;
                console.log(`[Telegram] Sent chunk to ${chatId}.`);
            }
        }
    } catch (err) {
        console.error(`[Telegram Error] Failed to send message to ${chatId}: ${err.message}`);
        // This specific error (failed to send message) won't cause a 502 on the webhook.
        // It means your bot couldn't send a reply *after* processing the update.
    }
}

// Load knowledge base
let KNOWLEDGE_BASE;
try {
    KNOWLEDGE_BASE = require('./knowledgeBase.js');
    console.log('Knowledge base loaded:', Object.keys(KNOWLEDGE_BASE).length, 'terms');
} catch (err) {
    console.error('FATAL ERROR: Failed to load knowledgeBase.js:', err.message);
    process.exit(1);
}

// --- Bot Commands ---
bot.command(['start', 'help'], async (ctx) => {
    const chatId = ctx.chat.id;
    const userName = ctx.from.first_name;
    const availableTopics = Object.keys(KNOWLEDGE_BASE).sort().join(', ');
    const welcomeMessage = `Hello, ${userName}! 👋\n\nI am a bot with knowledge from a glossary of epidemiology terms.\n\nYou can ask me to define any of the following topics:\n• ${availableTopics}`;
    console.log(`[Command /start or /help] User: ${userName} (${chatId})`);
    await sendTelegramMessageSafely(chatId, welcomeMessage, bot);
});

// --- Message Handler ---
bot.on('message', async (ctx) => {
    const userMessage = ctx.message.text?.trim().toLowerCase();
    // Ignore empty messages or commands
    if (!userMessage || userMessage.startsWith('/')) {
        console.log(`[Message] Ignoring command or empty message from ${ctx.chat.id}`);
        return;
    }

    const chatId = ctx.chat.id;
    console.log(`[Message] Received text from ${chatId}: "${userMessage}"`);

    // First, exact/partial match on keywords
    const termMatches = Object.keys(KNOWLEDGE_BASE).filter(keyword =>
        keyword.toLowerCase().includes(userMessage)
    );

    if (termMatches.length > 0) {
        console.log(`[Message] Found ${termMatches.length} keyword matches for "${userMessage}".`);
        for (const keyword of termMatches.slice(0, 5)) { // Limit to 5 replies
            await sendTelegramMessageSafely(chatId, KNOWLEDGE_BASE[keyword], bot, { parse_mode: 'Markdown' });
        }
        return; // Important: return after handling
    }

    // If no direct keyword match, try searching within definitions
    const searchWords = userMessage.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
    if (searchWords.length === 0) {
        console.log(`[Message] No valid search words extracted from "${userMessage}".`);
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
        console.log(`[Message] Found ${definitionMatches.length} definition matches for "${userMessage}".`);
        for (const match of definitionMatches.slice(0, 5)) { // Limit to 5 replies
            await sendTelegramMessageSafely(chatId, KNOWLEDGE_BASE[match.keyword], bot, { parse_mode: 'Markdown' });
        }
    } else {
        console.log(`[Message] No matches found for "${userMessage}".`);
        await sendTelegramMessageSafely(chatId, "I'm sorry, I don't have information on that topic. Please try asking about one of the keywords mentioned in /help.", bot);
    }
});

// --- Server Listener ---
const PORT = process.env.PORT || 8080; // Ensure this is 8080 for Railway
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Handle termination signals for graceful shutdown
process.once('SIGINT', () => {
    console.log('Stopping bot via SIGINT...');
    if (bot && typeof bot.stop === 'function') {
        bot.stop('SIGINT');
    }
    process.exit(0);
});
process.once('SIGTERM', () => {
    console.log('Stopping bot via SIGTERM...');
    if (bot && typeof bot.stop === 'function') {
        bot.stop('SIGTERM');
    }
    process.exit(0);
});
