// // db.js
// const { Sequelize } = require('sequelize');
// require('dotenv').config();

// const sequelize = new Sequelize(
//   process.env.DB_NAME,
//   process.env.DB_USER,
//   process.env.DB_PASS,
//   {
//     host: process.env.DB_HOST,
//     dialect: 'mysql',
//     port: process.env.DB_PORT,
//     logging: false, // set to true if you want to see SQL logs
//   }
// );

// sequelize.authenticate()
//   .then(() => console.log('Database connected'))
//   .catch(err => console.error('Unable to connect to database:', err));

// module.exports = sequelize;
// src/models/db.js
const { Sequelize } = require('sequelize');
const path = require('path');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    port: process.env.DB_PORT,
    logging: false,
  }
);  

module.exports = sequelize;