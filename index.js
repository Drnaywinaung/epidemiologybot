// This line loads the environment variables from your .env file
require('dotenv').config();

// Import the necessary libraries
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path'); // Import the path module

// --- Database Connection ---
// This logic checks if we are in a production environment (like Render).
// If so, it uses the persistent disk path '/data/'. Otherwise, it uses the local path.
const dbPath = process.env.NODE_ENV === 'production'
    ? '/data/epidemiology.db'
    : path.join(__dirname, 'epidemiology.db');

// Connect to the SQLite database file.
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error("FATAL ERROR: Could not connect to the database.", err.message);
        process.exit(1); // Exit if the database can't be opened
    }
    console.log(`Successfully connected to the knowledge base at ${dbPath}`);
});


// --- Bot Setup ---
const token = process.env.TELEGRAM_BOT_TOKEN;

// Pre-run Check for the token
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN is not defined in your .env file or environment variables.");
    process.exit(1);
}

// For deployment, we use webhooks. For local dev, we use polling.
const bot = process.env.NODE_ENV === 'production'
    ? new TelegramBot(token)
    : new TelegramBot(token, { polling: true });

// If in production, set up the webhook
if (process.env.NODE_ENV === 'production') {
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

    db.all("SELECT term FROM terms ORDER BY term ASC", [], (err, rows) => {
        if (err) {
            console.error('Error fetching terms:', err.message);
            bot.sendMessage(chatId, "Sorry, I'm having trouble accessing my knowledge base.");
            return;
        }
        const availableTopics = rows.map(row => row.term).join(', ');
        const welcomeMessage = `Hello, ${userName}! 👋\n\nI am a bot with knowledge from a glossary of epidemiology terms.\n\nYou can ask me to define any of the following topics:\n• ${availableTopics}`;
        bot.sendMessage(chatId, welcomeMessage);
    });
});

// --- Main Message Handler with Database Search Logic ---
bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // Ignore commands

    const chatId = msg.chat.id;
    const userMessage = msg.text.trim();
    const userMessageLower = userMessage.toLowerCase();

    const termQuery = "SELECT term, definition FROM terms WHERE LOWER(term) LIKE ? ORDER BY LENGTH(term) ASC LIMIT 5";
    db.all(termQuery, [`%${userMessageLower}%`], (err, rows) => {
        if (err) { console.error('Term search error:', err.message); return; }

        if (rows.length > 0) {
            rows.forEach(row => bot.sendMessage(chatId, row.definition, { parse_mode: 'Markdown' }));
            return;
        }

        const searchWords = userMessageLower.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
        if (searchWords.length === 0) {
            bot.sendMessage(chatId, "Please provide some keywords to search for.");
            return;
        }

        const definitionQuery = `SELECT term, definition FROM terms WHERE ${searchWords.map(() => "LOWER(definition) LIKE ?").join(' AND ')} LIMIT 5`;
        const queryParams = searchWords.map(word => `%${word}%`);

        db.all(definitionQuery, queryParams, (err, definitionRows) => {
            if (err) { console.error('Definition search error:', err.message); return; }

            if (definitionRows.length > 0) {
                definitionRows.forEach(row => bot.sendMessage(chatId, row.definition, { parse_mode: 'Markdown' }));
            } else {
                bot.sendMessage(chatId, "I'm sorry, I don't have information on that topic. Please try asking about one of the keywords mentioned in /help.");
            }
        });
    });
});

// --- Webhook Server (for Production on Render) ---
if (process.env.NODE_ENV === 'production') {
    const express = require('express');
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
