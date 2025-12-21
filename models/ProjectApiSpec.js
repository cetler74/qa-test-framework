const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProjectApiSpec = sequelize.define('ProjectApiSpec', {
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
  api_spec_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'api_specs',
      key: 'id'
    }
  },
  added_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'project_api_specs',
  timestamps: false
});

module.exports = ProjectApiSpec;

