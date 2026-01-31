const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PlaywrightRun = sequelize.define('PlaywrightRun', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  base_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'projects',
      key: 'id'
    }
  },
  total_tests: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  passed_tests: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  failed_tests: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  duration_ms: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'playwright_runs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = PlaywrightRun;
