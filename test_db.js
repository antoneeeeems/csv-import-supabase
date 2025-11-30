const result = require('dotenv').config();
// Try port 6543 (Transaction Pooler)
const originalUrl = process.env.DATABASE_URL;
const transactionUrl = originalUrl.replace('5432', '6543');

console.log('Testing Transaction URL:', transactionUrl.split('@')[1]);

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: transactionUrl,
  ssl: { rejectUnauthorized: false } 
});

async function testConnection() {
  try {
    console.log('Attempting to connect to:', process.env.DATABASE_URL.split('@')[1]); // Log host only for privacy
    const client = await pool.connect();
    console.log('Successfully connected!');
    const res = await client.query('SELECT NOW()');
    console.log('Current time from DB:', res.rows[0]);
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('Connection error:', err);
    process.exit(1);
  }
}

testConnection();
