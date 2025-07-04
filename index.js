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

// --- Bot Command Handlers ---
bot.onText(/\/start|\/help/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name;
    const availableTopics = Object.keys(KNOWLEDGE_BASE).sort().join(', ');
    const welcomeMessage = `Hello, ${userName}! 👋\n\nI am a bot with knowledge from a glossary of epidemiology terms.\n\nYou can ask me to define any of the following topics:\n• ${availableTopics}`;
    bot.sendMessage(chatId, welcomeMessage);
});

// --- Main Message Handler with Search Logic ---
bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // Ignore commands

    const chatId = msg.chat.id;
    const userMessage = msg.text.trim().toLowerCase();

    // Step 1: Prioritize searching within the terms (keywords)
    const termMatches = Object.keys(KNOWLEDGE_BASE).filter(keyword => 
        keyword.toLowerCase().includes(userMessage)
    );

    if (termMatches.length > 0) {
        termMatches.slice(0, 5).forEach(keyword => {
            bot.sendMessage(chatId, KNOWLEDGE_BASE[keyword], { parse_mode: 'Markdown' });
        });
        return;
    }

    // Step 2: Fallback to searching within definitions
    const searchWords = userMessage.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
    if (searchWords.length === 0) {
        bot.sendMessage(chatId, "Please provide some keywords to search for.");
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
        definitionMatches.slice(0, 5).forEach(match => {
            bot.sendMessage(chatId, KNOWLEDGE_BASE[match.keyword], { parse_mode: 'Markdown' });
        });
    } else {
        bot.sendMessage(chatId, "I'm sorry, I don't have information on that topic. Please try asking about one of the keywords mentioned in /help.");
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
