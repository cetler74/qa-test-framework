const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SoapOperation = sequelize.define('SoapOperation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  api_spec_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'api_specs',
      key: 'id'
    }
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  operation_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  request_template: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'soap_operations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = SoapOperation;
