const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FlowTask = sequelize.define('FlowTask', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  flow_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'flows',
      key: 'id'
    }
  },
  task_type: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  task_ref: {
    type: DataTypes.JSONB,
    allowNull: false
  },
  position: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'flow_tasks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = FlowTask;
