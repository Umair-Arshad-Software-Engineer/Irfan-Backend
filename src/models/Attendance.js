const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Attendance = sequelize.define('Attendance', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    date: {
      type: DataTypes.DATEONLY,   // stores YYYY-MM-DD, no time zone drift
      allowNull: false,
    },
    status: {
      // Present / Absent / Half Day / Leave
      type: DataTypes.ENUM('Present', 'Absent', 'Half_Day', 'Leave'),
      allowNull: false,
      defaultValue: 'Present',
    },
    notes: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  }, {
    tableName: 'attendance',
    timestamps: true,
    underscored: false,
    indexes: [
      {
        unique: true,
        fields: ['employee_id', 'date'],   // one record per employee per day
      },
    ],
  });

  return Attendance;
};