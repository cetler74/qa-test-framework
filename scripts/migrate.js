const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

async function runMigrations() {
  // Validate environment variables
  const dbPassword = process.env.DB_PASSWORD;
  if (dbPassword === undefined || dbPassword === null) {
    console.error('Error: DB_PASSWORD is not set in .env file');
    console.error('Please create a .env file with your database credentials.');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: String(dbPassword), // Ensure password is a string
    database: 'postgres' // Connect to default database first
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    // Check if database exists, create if not
    const dbName = process.env.DB_NAME || 'qa_testing';
    const dbCheck = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (dbCheck.rows.length === 0) {
      console.log(`Creating database ${dbName}...`);
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`Database ${dbName} created successfully`);
    } else {
      console.log(`Database ${dbName} already exists`);
    }

    await client.end();

    // Connect to the qa_testing database
    const dbClient = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: String(dbPassword), // Ensure password is a string
      database: dbName
    });

    await dbClient.connect();
    console.log(`Connected to database ${dbName}`);

    // Read and execute migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (file === '000_create_database.sql') {
        continue; // Skip database creation as we handle it above
      }

      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await dbClient.query(sql);
      console.log(`Migration ${file} completed`);
    }

    await dbClient.end();
    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

runMigrations();

