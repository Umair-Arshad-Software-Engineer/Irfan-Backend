// supplier model - Updated
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Supplier extends Model {
    static associate(models) {
      // Supplier has many cheques
      Supplier.hasMany(models.Cheque, {
        foreignKey: 'supplier_id',
        as: 'cheques'
      });
      
      // Supplier has many ledger entries
      Supplier.hasMany(models.SupplierLedger, {
        foreignKey: 'supplier_id',
        as: 'ledgerEntries'
      });
      
      // Supplier has many payments
      Supplier.hasMany(models.SupplierLedger, {
        foreignKey: 'supplier_id',
        as: 'payments',
        scope: {
          reference_type: 'payment'
        }
      });
      
      // Add other associations as needed
    }
  }

  Supplier.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: {
          msg: 'Supplier name is required'
        },
        len: {
          args: [2, 100],
          msg: 'Supplier name must be between 2 and 100 characters'
        }
      }
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: {
          args: [0, 500],
          msg: 'Address must not exceed 500 characters'
        }
      }
    },
    contact: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: {
          msg: 'Contact information is required'
        },
        len: {
          args: [2, 50],
          msg: 'Contact must be between 2 and 50 characters'
        }
      }
    },
    discount_percent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0.00,
      validate: {
        min: {
          args: [0],
          msg: 'Discount cannot be negative'
        },
        max: {
          args: [100],
          msg: 'Discount cannot exceed 100%'
        }
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'Supplier',
    tableName: 'suppliers',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['name']
      }
    ]
  });

  return Supplier;
};