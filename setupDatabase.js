// This is a one-time setup script to migrate your data from knowledgeBase.js to a SQLite database.
const sqlite3 = require('sqlite3').verbose();
const KNOWLEDGE_BASE = require('./knowledgeBase.js');

// This will create the database file if it doesn't exist.
const db = new sqlite3.Database('./epidemiology.db', (err) => {
    if (err) {
        return console.error('Error opening database:', err.message);
    }
    console.log('Connected to the SQLite database.');
});

db.serialize(() => {
    // Create the 'terms' table
    // We use a virtual FTS5 table for efficient full-text searching on the definitions.
    console.log('Creating terms table...');
    db.run(`
        CREATE TABLE IF NOT EXISTS terms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            term TEXT NOT NULL UNIQUE,
            definition TEXT NOT NULL
        )
    `, (err) => {
        if (err) {
            return console.error('Error creating table:', err.message);
        }
        console.log('Table "terms" created successfully.');

        // Prepare the statement for inserting data
        const stmt = db.prepare("INSERT OR IGNORE INTO terms (term, definition) VALUES (?, ?)");

        console.log('Inserting data from knowledgeBase.js...');
        let count = 0;
        for (const term in KNOWLEDGE_BASE) {
            stmt.run(term, KNOWLEDGE_BASE[term], (err) => {
                if (err) {
                    console.error(`Error inserting term "${term}":`, err.message);
                } else {
                    count++;
                }
            });
        }

        // Finalize the statement after all insertions are queued
        stmt.finalize((err) => {
            if (err) {
                return console.error('Error finalizing statement:', err.message);
            }
            console.log(`Successfully inserted ${count} new terms.`);
            
            // Close the database connection
            db.close((err) => {
                if (err) {
                    return console.error('Error closing database:', err.message);
                }
                console.log('Database setup complete. You can now run your main bot.');
            });
        });
    });
});
