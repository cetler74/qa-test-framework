const { TestRun } = require('../models');
const { Op } = require('sequelize');

(async () => {
  try {
    const res = await TestRun.findAll({ where: { name: { [Op.like]: '%Smart2M%' } }, limit: 50 });
    console.log('Found', res.length, 'rows for name like %Smart2M%');
    res.forEach(r => console.log(r.name));
    process.exit(0);
  } catch (err) {
    console.error('Error', err);
    process.exit(1);
  }
})();