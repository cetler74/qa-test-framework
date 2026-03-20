const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Collection = sequelize.define('Collection', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  version: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  collection_json: {
    type: DataTypes.JSONB,
    allowNull: false
  },
  original_file_content: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  original_file_name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  original_is_exact: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  api_spec_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'api_specs',
      key: 'id'
    }
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'projects',
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
  tableName: 'collections',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Collection;

