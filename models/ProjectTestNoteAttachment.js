const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProjectTestNoteAttachment = sequelize.define('ProjectTestNoteAttachment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  project_test_note_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'project_test_notes',
      key: 'id'
    }
  },
  original_name: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  stored_name: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  mime_type: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  file_size_bytes: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'project_test_note_attachments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = ProjectTestNoteAttachment;