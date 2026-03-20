/**
 * Create or update a PAM admin user (no password in DB; they sign in via OS account).
 * Set PAM_ADMIN_USERNAME in .env and run: node scripts/seed-pam-admin.js
 * After running, the user can log in with strategy 'pam' and will have is_admin: true.
 */
const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '../.env');
let adminUsername;
const envExists = fs.existsSync(envPath);
if (envExists) {
  const raw = fs.readFileSync(envPath, 'utf8');
  const parsed = require('dotenv').parse(raw);
  Object.assign(process.env, parsed);
  adminUsername = (parsed.PAM_ADMIN_USERNAME || process.env.PAM_ADMIN_USERNAME || '').trim();
}
if (!adminUsername) {
  require('dotenv').config({ path: envPath });
  adminUsername = (process.env.PAM_ADMIN_USERNAME || '').trim();
}
if (!adminUsername) {
  console.error('Set PAM_ADMIN_USERNAME in .env and run: node scripts/seed-pam-admin.js');
  process.exit(1);
}

const { sequelize, User } = require('../models');

async function main() {
  const [user, created] = await User.findOrCreate({
    where: { username: adminUsername },
    defaults: {
      auth_source: 'pam',
      is_admin: true,
      display_name: adminUsername
    }
  });
  if (!created) {
    await user.update({ auth_source: 'pam', is_admin: true });
    console.log('Updated PAM admin user:', adminUsername);
  } else {
    console.log('Created PAM admin user:', adminUsername);
  }
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
