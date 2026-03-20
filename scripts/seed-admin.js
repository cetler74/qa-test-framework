/**
 * Create or update an admin user (local auth).
 * Set ADMIN_USERNAME and ADMIN_PASSWORD in .env and run: node scripts/seed-admin.js
 */
const path = require('path');
const fs = require('fs');
// Load .env from project root before any other requires (so config/database doesn't run first)
const envPath = path.resolve(__dirname, '../.env');
let adminUsername;
let adminPassword;
const envExists = fs.existsSync(envPath);
if (envExists) {
  const raw = fs.readFileSync(envPath, 'utf8');
  const parsed = require('dotenv').parse(raw);
  Object.assign(process.env, parsed);
  adminUsername = (parsed.ADMIN_USERNAME || process.env.ADMIN_USERNAME || '').trim();
  adminPassword = parsed.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
}
if (!adminUsername || !adminPassword) {
  require('dotenv').config({ path: envPath });
  adminUsername = (process.env.ADMIN_USERNAME || '').trim();
  adminPassword = process.env.ADMIN_PASSWORD;
}
if (!adminUsername || !adminPassword) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD in .env and run: node scripts/seed-admin.js');
  console.error('If .env already has them, ensure the file is saved (the script reads from disk).');
  process.exit(1);
}

const bcrypt = require('bcrypt');
const { sequelize, User } = require('../models');

async function main() {
  const username = adminUsername;
  const password = adminPassword;
  const hash = await bcrypt.hash(password, 10);
  const [user, created] = await User.findOrCreate({
    where: { username },
    defaults: {
      auth_source: 'local',
      password_hash: hash,
      is_admin: true,
      display_name: username
    }
  });
  if (!created) {
    await user.update({
      password_hash: hash,
      is_admin: true,
      auth_source: 'local'
    });
    console.log('Updated admin user:', username);
  } else {
    console.log('Created admin user:', username);
  }
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
