const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProjectTest = sequelize.define('ProjectTest', {
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
  test_type: {
    type: DataTypes.STRING(32),
    allowNull: false
  },
  source_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  source_kind: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  stable_key: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  ticket_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  endpoint: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  method: {
    type: DataTypes.STRING(32),
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
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
  tableName: 'project_tests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = ProjectTest;

