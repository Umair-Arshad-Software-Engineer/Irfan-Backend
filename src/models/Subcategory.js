const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Subcategory = sequelize.define('Subcategory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [2, 100]
      }
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'categories',
        key: 'id'
      }
    }
  }, {
    tableName: 'subcategories',
    timestamps: true,
    underscored: false,
    indexes: [
      {
        unique: true,
        fields: ['name', 'category_id']
      }
    ]
  });

  return Subcategory;
};