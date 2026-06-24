module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');
  const BuildTransaction = sequelize.define('BuildTransaction', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    product_id:      { type: DataTypes.INTEGER, allowNull: false },
    product_name:    { type: DataTypes.STRING,  allowNull: false },
    quantity_built:  { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    bom_sale_rate:   { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    build_amount:    { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    bom_total_cost:  { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    build_date:      { type: DataTypes.DATEONLY, allowNull: false },
    notes:           { type: DataTypes.TEXT, allowNull: true },
    is_deleted:      { type: DataTypes.BOOLEAN, defaultValue: false },
    components_used: {
      type: DataTypes.JSON,
      allowNull: true,
      get() {
        const v = this.getDataValue('components_used');
        return v ? (typeof v === 'string' ? JSON.parse(v) : v) : [];
      },
    },
  }, {
    tableName: 'build_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });
  return BuildTransaction;
};