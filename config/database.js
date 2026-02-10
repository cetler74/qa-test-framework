const { Sequelize } = require('sequelize');
require('dotenv').config();

// Ensure password is a string
const dbPassword = process.env.DB_PASSWORD !== undefined && process.env.DB_PASSWORD !== null 
  ? String(process.env.DB_PASSWORD) 
  : '';

const sequelize = new Sequelize(
  process.env.DB_NAME || 'qa_framework',
  process.env.DB_USER || 'postgres',
  dbPassword,
  {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// Test connection
sequelize.authenticate()
  .then(() => {
    console.log('Database connection established successfully.');
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
  });

module.exports = sequelize;

