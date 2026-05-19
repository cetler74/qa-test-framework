const sequelize = require('../config/database');
const Project = require('./Project');
const User = require('./User');
const ProjectMember = require('./ProjectMember');
const ApiSpec = require('./ApiSpec');
const Collection = require('./Collection');
const TestRun = require('./TestRun');
const TestResult = require('./TestResult');
const ProjectApiSpec = require('./ProjectApiSpec');
const PlaywrightRun = require('./PlaywrightRun');
const PlaywrightResult = require('./PlaywrightResult');
const PlaywrightRecordedTest = require('./PlaywrightRecordedTest');
const ProjectRecordedTest = require('./ProjectRecordedTest');
const Flow = require('./Flow');
const FlowTask = require('./FlowTask');
const Schedule = require('./Schedule');
const SoapOperation = require('./SoapOperation');
const FuzzRun = require('./FuzzRun');
const FuzzResult = require('./FuzzResult');
const ProjectTest = require('./ProjectTest');
const ProjectTestStat = require('./ProjectTestStat');
const ProjectTestNote = require('./ProjectTestNote');
const ProjectTestNoteAttachment = require('./ProjectTestNoteAttachment');

// Define associations
Project.belongsTo(User, { foreignKey: 'owner_id', as: 'owner' });
User.hasMany(Project, { foreignKey: 'owner_id', as: 'ownedProjects' });
Project.belongsToMany(User, {
  through: ProjectMember,
  foreignKey: 'project_id',
  otherKey: 'user_id',
  as: 'members'
});
User.belongsToMany(Project, {
  through: ProjectMember,
  foreignKey: 'user_id',
  otherKey: 'project_id',
  as: 'memberProjects'
});

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

Project.hasMany(Collection, {
  foreignKey: 'project_id',
  as: 'standaloneCollections'
});

Collection.belongsTo(Project, {
  foreignKey: 'project_id',
  as: 'project'
});

Project.hasMany(TestRun, {
  foreignKey: 'project_id',
  as: 'testRuns'
});

TestRun.belongsTo(Project, {
  foreignKey: 'project_id',
  as: 'project'
});

TestRun.belongsTo(User, {
  foreignKey: 'run_by_user_id',
  as: 'runByUser'
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

Project.hasMany(Flow, {
  foreignKey: 'project_id',
  as: 'flows'
});

Flow.belongsTo(Project, {
  foreignKey: 'project_id',
  as: 'project'
});

Flow.hasMany(FlowTask, {
  foreignKey: 'flow_id',
  as: 'flowTasks'
});

FlowTask.belongsTo(Flow, {
  foreignKey: 'flow_id',
  as: 'flow'
});

TestRun.belongsTo(Flow, {
  foreignKey: 'flow_id',
  as: 'flow'
});

Flow.hasMany(TestRun, {
  foreignKey: 'flow_id',
  as: 'testRuns'
});

PlaywrightRun.belongsTo(Flow, {
  foreignKey: 'flow_id',
  as: 'flow'
});

Flow.hasMany(PlaywrightRun, {
  foreignKey: 'flow_id',
  as: 'playwrightRuns'
});

Project.hasMany(Schedule, {
  foreignKey: 'project_id',
  as: 'schedules'
});

Schedule.belongsTo(Project, {
  foreignKey: 'project_id',
  as: 'project'
});

Schedule.belongsTo(Flow, {
  foreignKey: 'flow_id',
  as: 'flow'
});

Flow.hasMany(Schedule, {
  foreignKey: 'flow_id',
  as: 'schedules'
});

Project.hasMany(FuzzRun, {
  foreignKey: 'project_id',
  as: 'fuzzRuns'
});

FuzzRun.belongsTo(Project, {
  foreignKey: 'project_id',
  as: 'project'
});

ApiSpec.hasMany(FuzzRun, {
  foreignKey: 'api_spec_id',
  as: 'fuzzRuns'
});

FuzzRun.belongsTo(ApiSpec, {
  foreignKey: 'api_spec_id',
  as: 'apiSpec'
});

FuzzRun.hasMany(FuzzResult, {
  foreignKey: 'fuzz_run_id',
  as: 'fuzzResults'
});

FuzzResult.belongsTo(FuzzRun, {
  foreignKey: 'fuzz_run_id',
  as: 'fuzzRun'
});

Flow.hasMany(FuzzRun, {
  foreignKey: 'flow_id',
  as: 'fuzzRuns'
});

FuzzRun.belongsTo(Flow, {
  foreignKey: 'flow_id',
  as: 'flow'
});

Project.hasMany(ProjectTest, {
  foreignKey: 'project_id',
  as: 'tests'
});

ProjectTest.belongsTo(Project, {
  foreignKey: 'project_id',
  as: 'project'
});

ProjectTest.hasOne(ProjectTestStat, {
  foreignKey: 'project_test_id',
  as: 'stats'
});

ProjectTestStat.belongsTo(ProjectTest, {
  foreignKey: 'project_test_id',
  as: 'projectTest'
});

ProjectTestStat.belongsTo(User, {
  foreignKey: 'last_run_by_user_id',
  as: 'lastRunByUser'
});

ProjectTest.hasMany(ProjectTestNote, {
  foreignKey: 'project_test_id',
  as: 'notes'
});

ProjectTestNote.belongsTo(ProjectTest, {
  foreignKey: 'project_test_id',
  as: 'projectTest'
});

ProjectTestNote.hasMany(ProjectTestNoteAttachment, {
  foreignKey: 'project_test_note_id',
  as: 'attachments'
});

ProjectTestNoteAttachment.belongsTo(ProjectTestNote, {
  foreignKey: 'project_test_note_id',
  as: 'note'
});

module.exports = {
  sequelize,
  Project,
  User,
  ProjectMember,
  ApiSpec,
  Collection,
  TestRun,
  TestResult,
  ProjectApiSpec,
  PlaywrightRun,
  PlaywrightResult,
  PlaywrightRecordedTest,
  ProjectRecordedTest,
  Flow,
  FlowTask,
  Schedule,
  SoapOperation,
  FuzzRun,
  FuzzResult,
  ProjectTest,
  ProjectTestStat,
  ProjectTestNote,
  ProjectTestNoteAttachment
};

