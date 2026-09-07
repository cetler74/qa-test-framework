const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RunCatalogueMembership = sequelize.define('RunCatalogueMembership', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  run_type: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  run_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  project_test_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  association_status: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'exact'
  },
  execution_order: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'run_catalogue_memberships',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = RunCatalogueMembership;