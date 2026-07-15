const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TestResult = sequelize.define('TestResult', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  test_run_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'test_runs',
      key: 'id'
    }
  },
  test_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  endpoint: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  method: {
    type: DataTypes.STRING(10),
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  duration_ms: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  request_body: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  response_body: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  response_code: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  assertions: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  api_spec_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'api_specs',
      key: 'id'
    }
  },
  execution_order: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  test_id: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  project_test_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'project_tests',
      key: 'id'
    }
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'test_results',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = TestResult;

