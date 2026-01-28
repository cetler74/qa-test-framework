const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PlaywrightResult = sequelize.define('PlaywrightResult', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  playwright_run_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'playwright_runs',
      key: 'id'
    }
  },
  test_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  duration_ms: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  endpoint: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  assertions: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  execution_order: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'playwright_results',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = PlaywrightResult;
