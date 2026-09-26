const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PlaywrightRecordedTest = sequelize.define('PlaywrightRecordedTest', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  label: {
    type: DataTypes.STRING(120),
    allowNull: true
  },
  spec_content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  base_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'playwright_recorded_tests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = PlaywrightRecordedTest;
