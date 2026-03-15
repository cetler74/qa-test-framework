const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TestRun = sequelize.define('TestRun', {
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
  run_type: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'api'
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
  },
  run_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  }
}, {
  tableName: 'test_runs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = TestRun;

