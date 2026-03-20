const { sequelize, ProjectTest } = require('../models');

async function main() {
  try {
    await sequelize.authenticate();
    const count = await ProjectTest.destroy({
      where: { test_type: 'ui_builtin' }
    });
    console.log(`[cleanup] Removed ${count} ui_builtin project_tests rows (and cascading stats/notes).`);
  } catch (err) {
    console.error('[cleanup] Error while removing ui_builtin project tests:', err);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();

