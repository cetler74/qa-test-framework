const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProjectRecordedTest = sequelize.define('ProjectRecordedTest', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'projects',
      key: 'id'
    }
  },
  recorded_test_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'playwright_recorded_tests',
      key: 'id'
    }
  },
  added_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'project_recorded_tests',
  timestamps: false
});

module.exports = ProjectRecordedTest;
