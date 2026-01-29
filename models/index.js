const sequelize = require('../config/database');
const Project = require('./Project');
const ApiSpec = require('./ApiSpec');
const Collection = require('./Collection');
const TestRun = require('./TestRun');
const TestResult = require('./TestResult');
const ProjectApiSpec = require('./ProjectApiSpec');
const PlaywrightRun = require('./PlaywrightRun');
const PlaywrightResult = require('./PlaywrightResult');
const PlaywrightRecordedTest = require('./PlaywrightRecordedTest');
const ProjectRecordedTest = require('./ProjectRecordedTest');

// Define associations
Project.belongsToMany(ApiSpec, {
  through: ProjectApiSpec,
  foreignKey: 'project_id',
  otherKey: 'api_spec_id',
  as: 'apiSpecs'
});

ApiSpec.belongsToMany(Project, {
  through: ProjectApiSpec,
  foreignKey: 'api_spec_id',
  otherKey: 'project_id',
  as: 'projects'
});

ApiSpec.hasMany(Collection, {
  foreignKey: 'api_spec_id',
  as: 'collections'
});

Collection.belongsTo(ApiSpec, {
  foreignKey: 'api_spec_id',
  as: 'apiSpec'
});

Project.hasMany(TestRun, {
  foreignKey: 'project_id',
  as: 'testRuns'
});

TestRun.belongsTo(Project, {
  foreignKey: 'project_id',
  as: 'project'
});

TestRun.hasMany(TestResult, {
  foreignKey: 'test_run_id',
  as: 'testResults'
});

TestResult.belongsTo(TestRun, {
  foreignKey: 'test_run_id',
  as: 'testRun'
});

TestResult.belongsTo(ApiSpec, {
  foreignKey: 'api_spec_id',
  as: 'apiSpec'
});

PlaywrightRun.hasMany(PlaywrightResult, {
  foreignKey: 'playwright_run_id',
  as: 'results'
});

PlaywrightResult.belongsTo(PlaywrightRun, {
  foreignKey: 'playwright_run_id',
  as: 'playwrightRun'
});

Project.hasMany(PlaywrightRun, {
  foreignKey: 'project_id',
  as: 'playwrightRuns'
});

PlaywrightRun.belongsTo(Project, {
  foreignKey: 'project_id',
  as: 'project'
});

Project.belongsToMany(PlaywrightRecordedTest, {
  through: ProjectRecordedTest,
  foreignKey: 'project_id',
  otherKey: 'recorded_test_id',
  as: 'recordedTests'
});

PlaywrightRecordedTest.belongsToMany(Project, {
  through: ProjectRecordedTest,
  foreignKey: 'recorded_test_id',
  otherKey: 'project_id',
  as: 'projects'
});

module.exports = {
  sequelize,
  Project,
  ApiSpec,
  Collection,
  TestRun,
  TestResult,
  ProjectApiSpec,
  PlaywrightRun,
  PlaywrightResult,
  PlaywrightRecordedTest,
  ProjectRecordedTest
};

