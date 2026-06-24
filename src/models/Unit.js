const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Unit = sequelize.define('Unit', {
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
        notEmpty: true,
        len: [2, 50]
      }
    },
    symbol: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
        len: [1, 10]
      }
    },
    type: {
      type: DataTypes.ENUM('weight', 'volume', 'count', 'length', 'area', 'custom'),
      allowNull: false,
      defaultValue: 'custom'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    conversion_factor: {
      type: DataTypes.FLOAT,
      defaultValue: 1,
      validate: {
        min: 0.000001,
        max: 1000000
      }
    },
    base_unit_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'units',
        key: 'id'
      }
    }
  }, {
    timestamps: true,
    tableName: 'units',
    indexes: [
      {
        unique: true,
        fields: ['symbol']
      },
      {
        fields: ['type']
      },
      {
        fields: ['is_active']
      }
    ]
  });

  // Self-reference for base unit
  Unit.belongsTo(Unit, { as: 'baseUnit', foreignKey: 'base_unit_id' });
  Unit.hasMany(Unit, { as: 'derivedUnits', foreignKey: 'base_unit_id' });

  return Unit;
};