// src/models/Bank.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Bank extends Model {
    static associate(models) {
      Bank.hasMany(models.BankTransaction, {
        foreignKey: 'bank_id',
        as: 'transactions',
        onDelete: 'CASCADE'
      });
    }
  }

  Bank.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: {
          msg: 'Bank name is required'
        },
        len: {
          args: [2, 100],
          msg: 'Bank name must be between 2 and 100 characters'
        }
      }
    },
    icon_path: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'asset/bank_icons/default.png'
    },
    balance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        isDecimal: true,
        min: 0
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    account_number: {
      type: DataTypes.STRING,
      allowNull: true
    },
    branch_code: {
      type: DataTypes.STRING,
      allowNull: true
    },
    swift_code: {
      type: DataTypes.STRING,
      allowNull: true
    },
    iban: {
      type: DataTypes.STRING,
      allowNull: true
    },
    opening_balance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    }
  }, {
    sequelize,
    modelName: 'Bank',
    tableName: 'banks',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['name']
      },
      {
        fields: ['is_active']
      }
    ]
  });

  return Bank;
};