#!/bin/sh
set -e

# Wait for DB to be reachable (handles compose startup order and restarts)
echo "Waiting for database..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if node -e "
    const { Client } = require('pg');
    const c = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'qa_framework',
      connectionTimeoutMillis: 3000
    });
    c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
  " 2>/dev/null; then
    echo "Database is ready."
    break
  fi
  if [ "$i" = "10" ]; then
    echo "Error: Database not reachable after 10 attempts. Check DB_HOST, DB_PASSWORD, and that the db service is running."
    exit 1
  fi
  sleep 2
done

echo "Running database migrations..."
if ! node scripts/migrate.js; then
  echo "Migration failed. See error above."
  exit 1
fi

# Create or update admin user if ADMIN_USERNAME and ADMIN_PASSWORD are set (e.g. from .env via docker-compose)
if [ -n "$ADMIN_USERNAME" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "Seeding admin user..."
  if node scripts/seed-admin.js; then
    echo "Admin user ready."
  else
    echo "Warning: seed-admin failed (check ADMIN_USERNAME/ADMIN_PASSWORD in .env). You can run: docker compose exec app node scripts/seed-admin.js"
  fi
else
  echo "ADMIN_USERNAME/ADMIN_PASSWORD not set. To create an admin user, add them to .env and run: docker compose exec app node scripts/seed-admin.js"
fi

echo "Starting server..."
exec node server.js
