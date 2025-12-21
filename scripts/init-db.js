const sequelize = require('../config/database');
const models = require('../models');

async function initializeDatabase() {
  try {
    // Test connection
    await sequelize.authenticate();
    console.log('Database connection established.');

    // Sync models (create tables if they don't exist)
    // Note: This won't alter existing tables, only creates new ones
    await sequelize.sync({ alter: false });
    console.log('Database models synchronized.');

    console.log('Database initialization complete.');
    process.exit(0);
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

initializeDatabase();

