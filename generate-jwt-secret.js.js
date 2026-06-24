// generate-jwt-secret.js
const crypto = require('crypto');

// Generate a random string of 64 characters (256 bits)
const jwtSecret = crypto.randomBytes(32).toString('hex');

console.log('========================================');
console.log('YOUR JWT SECRET KEY:');
console.log('========================================');
console.log(jwtSecret);
console.log('========================================');
console.log('\n⚠️  WARNING:');
console.log('1. Keep this key secret!');
console.log('2. Never commit it to version control');
console.log('3. Add it to your .env file:');
console.log(`\nJWT_SECRET=${jwtSecret}`);
console.log('========================================');