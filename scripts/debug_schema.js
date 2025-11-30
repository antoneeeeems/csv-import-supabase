require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function inspect() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    
    console.log('Schema:');
    let currentTable = '';
    res.rows.forEach(r => {
        if (r.table_name !== currentTable) {
            console.log(`\nTable: ${r.table_name}`);
            currentTable = r.table_name;
        }
        console.log(` - ${r.column_name} (${r.data_type})`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

inspect();
