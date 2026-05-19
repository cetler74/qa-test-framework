const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProjectTestNote = sequelize.define('ProjectTestNote', {
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
  author_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  note: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'project_test_notes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = ProjectTestNote;

