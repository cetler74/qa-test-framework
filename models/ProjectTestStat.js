const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProjectTestStat = sequelize.define('ProjectTestStat', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  project_test_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'project_tests',
      key: 'id'
    }
  },
  total_runs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  last_status: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'not_run'
  },
  last_run_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_run_source: {
    type: DataTypes.STRING(32),
    allowNull: true
  },
  last_run_type: {
    type: DataTypes.STRING(32),
    allowNull: true
  },
  last_run_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  last_run_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
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
  tableName: 'project_test_stats',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = ProjectTestStat;

