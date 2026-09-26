const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UsageEvent = sequelize.define('UsageEvent', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  action: {
    type: DataTypes.STRING(80),
    allowNull: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'usage_events',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = UsageEvent;
