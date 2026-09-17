const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserOnboardingProgress = sequelize.define('UserOnboardingProgress', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  tour_key: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  tour_version: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('offered', 'skipped', 'completed'),
    allowNull: false,
    defaultValue: 'offered'
  },
  offered_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  skipped_at: DataTypes.DATE,
  completed_at: DataTypes.DATE,
  replay_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  last_replayed_at: DataTypes.DATE,
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'user_onboarding_progress',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['user_id', 'tour_key', 'tour_version'] }]
});

module.exports = UserOnboardingProgress;