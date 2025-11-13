// --- database.js ---
// This file handles the MongoDB connection logic.

const { MongoClient } = require('mongodb');
require('dotenv').config();

const logger = require('./logger');

const uri = process.env.MONGODB_URI;
if (!uri) {
    logger.error('MONGODB_URI not found in .env file. Database connection failed.');
    throw new Error('MONGODB_URI not found in .env file');
}

const client = new MongoClient(uri);
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db(); // You can pass a DB name here if it's not in the URI
        logger.success('Connected successfully to MongoDB');
    } catch (error) {
        logger.error('Could not connect to MongoDB', error);
        process.exit(1); // Exit the process if DB connection fails
    }
}

function getDb() {
    if (!db) {
        logger.error('Database not initialized. Call connectDB first.');
        throw new Error('Database not initialized');
    }
    return db;
}

module.exports = { connectDB, getDb };