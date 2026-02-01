const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Schedule = sequelize.define('Schedule', {
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
  flow_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'flows',
      key: 'id'
    }
  },
  cron_expression: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  repeat_interval_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  last_run_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  next_run_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'schedules',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Schedule;
