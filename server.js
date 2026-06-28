const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dgram = require('dgram');
const os = require('os');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });
require('mysql2');

const sequelize = require('./src/config/db');
const User = require('./src/models/User');

const authRoutes = require('./src/routes/authRoutes');
const categoryRoutes = require('./src/routes/categoryRoutes');
const subcategoryRoutes = require('./src/routes/subcategoryRoutes');
const unitRoutes = require('./src/routes/unitRoutes');
const supplierRoutes = require('./src/routes/supplierRoutes');
const customerRoutes = require('./src/routes/customerRoutes');
const productRoutes = require('./src/routes/productRoutes');
const customerPriceRoutes = require('./src/routes/customerPriceRoutes');
const productImageRoutes = require('./src/routes/productImageRoutes');
const purchaseOrderRoutes = require('./src/routes/purchaseOrderRoutes');
const saleRoutes = require('./src/routes/saleRoutes');
const saleImageRoutes = require('./src/routes/saleImageRoutes');     // ← ADD
const customerLedgerRoutes = require('./src/routes/customerLedgerRoutes');
const bankRoutes = require('./src/routes/bankRoutes');
const chequeRoutes = require('./src/routes/cheque_routes');
const cashbookRoutes = require('./src/routes/cashbookRoutes');
const simpleCashbookRoutes = require('./src/routes/simpleCashbookRoutes');
const expenseRoutes = require('./src/routes/expenseRoutes');
const employeeRoutes   = require('./src/routes/employeeRoutes');
const attendanceRoutes = require('./src/routes/attendanceRoutes');
const salaryRoutes     = require('./src/routes/salaryRoutes');
const advanceRoutes    = require('./src/routes/advanceRoutes');
const empExpenseRoutes = require('./src/routes/empExpenseRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// ── UDP Discovery ────────────────────────────────────────────────────────────
function getLocalIP() {
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return '127.0.0.1';
}

const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg, rinfo) => {
  console.log(`📨 UDP packet received from ${rinfo.address}:${rinfo.port}`);
  console.log('Message:', msg.toString());

  if (msg.toString() === 'DISCOVER_SERVER') {
    const response = Buffer.from(
      JSON.stringify({ ip: getLocalIP(), port: PORT })
    );
    udpServer.send(response, rinfo.port, rinfo.address);
  }
});

udpServer.on('error', (err) => {
  console.error('❌ UDP server error:', err);
});

udpServer.bind(41234, () => {
  console.log('📡 UDP discovery listening on port 41234');
});
// ────────────────────────────────────────────────────────────────────────────

const ADMIN_USER = {
  name: 'Tech Soft',
  email: 'techsoft@gmail.com',
  password: '1129@AliHaider',
};

process.on('uncaughtException', err => console.error('UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION:', err));

app.use(cors({ origin: '*', credentials: true }));
app.use(bodyParser.json({ limit: '50mb' }));           // ← increased for base64 images
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' })); // ← increased

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/subcategories', subcategoryRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customer-prices', customerPriceRoutes);
app.use('/api', productImageRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api', saleImageRoutes);                      // ← ADD (mounts /api/sales/:saleId/images)
app.use('/api/customer-ledger', customerLedgerRoutes);
app.use('/api/banks', bankRoutes);
app.use('/api/cheques', chequeRoutes);
app.use('/api/cashbook', cashbookRoutes);
app.use('/api/simple-cashbook', simpleCashbookRoutes);
app.use('/api/expense-sessions', expenseRoutes);
app.use('/api/employees',   employeeRoutes);
app.use('/api/attendance',  attendanceRoutes);
app.use('/api/salary',      salaryRoutes);
app.use('/api/advances',     advanceRoutes);
app.use('/api/emp-expenses', empExpenseRoutes);

const uploadsPath = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log('📂 Created uploads folder');
}
app.use('/uploads', express.static(uploadsPath));

app.get('/', (req, res) => {
  res.json({ message: 'API running', timestamp: new Date().toISOString() });
});

async function seedAdminUser() {
  try {
    const existing = await User.findOne({ where: { email: ADMIN_USER.email } });
    if (existing) {
      console.log('ℹ️  Admin user already exists — skipping seed.');
      return;
    }
    await User.create({
      name: ADMIN_USER.name,
      email: ADMIN_USER.email,
      password: ADMIN_USER.password,
    });
  } catch (err) {
    console.error('❌ Failed to seed admin user:', err.message);
  }
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    await sequelize.sync({ alter: true });
    console.log('✅ Database & tables synced');

    await seedAdminUser();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Database error:', err);
    console.log('Press any key to exit...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 1));
  }
})();