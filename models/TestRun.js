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
  error_message: {
    type: DataTypes.TEXT,
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
  },
  execution_snapshot: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  execution_snapshot_version: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  rerun_lineage_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  rerun_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  rerun_base_name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  rerun_source_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'test_runs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = TestRun;

