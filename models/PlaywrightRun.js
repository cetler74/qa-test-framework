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
  flow_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'flows',
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
  video_path: {
    type: DataTypes.STRING(512),
    allowNull: true
  },
  trace_path: {
    type: DataTypes.STRING(512),
    allowNull: true
  },
  browser_name: {
    type: DataTypes.STRING(50),
    allowNull: true
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
