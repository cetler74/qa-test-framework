const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '..', 'public', 'favicon.svg');
const QA_TEST_HUB_LOGO_DATA_URI = `data:image/svg+xml;base64,${fs.readFileSync(logoPath).toString('base64')}`;

module.exports = { QA_TEST_HUB_LOGO_DATA_URI };