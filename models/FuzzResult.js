const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FuzzResult = sequelize.define('FuzzResult', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fuzz_run_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'fuzz_runs',
      key: 'id'
    }
  },
  test_name: {
    type: DataTypes.STRING(500),
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
  fuzzer_name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  execution_order: {
    type: DataTypes.INTEGER,
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
  tableName: 'fuzz_results',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = FuzzResult;
