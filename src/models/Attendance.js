// models/Attendance.js
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
    // Extra hours worked beyond standard hours (only for Present / Half_Day)
    overtime_hours: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0, max: 24 },
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