// backend/src/models/SaleImage.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SaleImage = sequelize.define('SaleImage', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    sale_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'sales', key: 'id' },
      onDelete: 'CASCADE',
    },
    image_type: {
      type: DataTypes.ENUM('signature', 'stamp', 'note', 'delivery', 'custom'),
      allowNull: false,
      defaultValue: 'custom',
    },
    image_data: {
      // Stores base64-encoded image string
      type: DataTypes.TEXT('long'), // ✅ Changed from LONGTEXT to TEXT('long')
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    uploaded_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
    },
  }, {
    tableName: 'sale_images',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['sale_id'] },
      { fields: ['image_type'] },
    ],
  });

  return SaleImage;
};