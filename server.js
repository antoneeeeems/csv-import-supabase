require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const fs = require('fs');
const csv = require('csv-parser');
const { from: copyFrom } = require('pg-copy-streams');
const path = require('path');

const app = express();
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
const upload = multer({ dest: 'uploads/' });

// Global error handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.static('public'));

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  let headers = [];

  // Read headers using csv-parser
  const readStream = fs.createReadStream(filePath);
  const parser = readStream.pipe(csv());

  parser.on('headers', (headerList) => {
    headers = headerList.map(h => h.trim());
    readStream.destroy(); // Stop reading
  });

  // Wait for stream to close (which happens after destroy)
  readStream.on('close', async () => {
    // If headers were not found (empty file), handle it
    if (headers.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: 'Could not read headers from CSV' });
    }

    try {
      const client = await pool.connect();
      try {
        // Fetch all public tables and their columns
        const result = await client.query(`
          SELECT table_name, column_name 
          FROM information_schema.columns 
          WHERE table_schema = 'public'
        `);

        // Map: TableName -> Map<LowerCaseColumn, ActualColumn>
        const tables = {};
        result.rows.forEach(row => {
          if (!tables[row.table_name]) {
            tables[row.table_name] = new Map();
          }
          tables[row.table_name].set(row.column_name.toLowerCase(), row.column_name);
        });

        let targetTable = null;
        let mappedColumns = [];

        for (const [tableName, columnsMap] of Object.entries(tables)) {
          // Check if all CSV headers exist in this table
          const allMatch = headers.every(h => columnsMap.has(h.toLowerCase()));
          
          if (allMatch) {
            targetTable = tableName;
            // Map CSV headers to actual DB column names
            mappedColumns = headers.map(h => columnsMap.get(h.toLowerCase()));
            break;
          }
        }

        if (!targetTable) {
          fs.unlinkSync(filePath);
          client.release();
          return res.status(400).json({ error: 'No matching table found for headers: ' + headers.join(', ') });
        }

        console.log(`Found matching table: ${targetTable}`);

        // Find Primary Key or Unique Constraints for ON CONFLICT
        const pkResult = await client.query(`
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
                AND tc.table_name = $1
                AND tc.table_schema = 'public'
        `, [targetTable]);

        const uniqueCols = [...new Set(pkResult.rows.map(r => r.column_name))];
        const availableUniqueCols = uniqueCols.filter(col => mappedColumns.includes(col));
        
        // Prepare Batch Insert
        const batchSize = 500;
        let batch = [];
        let totalInserted = 0;
        
        const processBatch = async (currentBatch) => {
            if (currentBatch.length === 0) return;

            const columnsStr = mappedColumns.map(c => `"${c}"`).join(',');
            
            // Construct VALUES ($1, $2...), ($3, $4...)...
            const valuesPlaceholders = [];
            const valuesData = [];
            let paramIndex = 1;

            currentBatch.forEach(row => {
                const rowPlaceholders = [];
                mappedColumns.forEach((col, i) => {
                    // headers[i] is the CSV header name for this column
                    // row is the object from csv-parser: { HeaderName: Value, ... }
                    let val = row[headers[i]];
                    if (val === '') val = null;
                    rowPlaceholders.push(`$${paramIndex++}`);
                    valuesData.push(val);
                });
                valuesPlaceholders.push(`(${rowPlaceholders.join(',')})`);
            });

            let query = `INSERT INTO "${targetTable}" (${columnsStr}) VALUES ${valuesPlaceholders.join(',')}`;

            if (availableUniqueCols.length > 0) {
                const conflictCols = availableUniqueCols.map(c => `"${c}"`).join(',');
                query += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
            } else {
                // No unique key? We can't easily dedupe without a key in a simple INSERT.
                // We could use WHERE NOT EXISTS but that's complex for batch insert.
                // For now, just INSERT (or maybe DO NOTHING if we can identify duplicates?)
                // If no PK, we assume append-only or user accepts duplicates.
                // OR we can try ON CONFLICT DO NOTHING if there is ANY unique constraint.
                // If absolutely no unique constraint, we just insert.
            }

            const res = await client.query(query, valuesData);
            totalInserted += res.rowCount;
        };

        const readStream = fs.createReadStream(filePath);
        const parserStream = readStream.pipe(csv());

        parserStream.on('data', (row) => {
            batch.push(row);
            if (batch.length >= batchSize) {
                parserStream.pause();
                processBatch(batch).then(() => {
                    batch = [];
                    parserStream.resume();
                }).catch(err => {
                    parserStream.destroy(err);
                });
            }
        });

        parserStream.on('end', async () => {
            try {
                if (batch.length > 0) {
                    await processBatch(batch);
                }
                console.log('Import completed. Rows inserted:', totalInserted);
                client.release();
                try { fs.unlinkSync(filePath); } catch(e) {}
                if (!res.headersSent) res.json({ message: `Successfully imported ${totalInserted} new rows into table: ${targetTable}` });
            } catch (err) {
                console.error('Batch Insert Error:', err);
                client.release();
                try { fs.unlinkSync(filePath); } catch(e) {}
                if (!res.headersSent) res.status(500).json({ error: 'Database error: ' + err.message });
            }
        });

        parserStream.on('error', (err) => {
             console.error('CSV Parse Error:', err);
             client.release();
             try { fs.unlinkSync(filePath); } catch(e) {}
             if (!res.headersSent) res.status(500).json({ error: 'CSV Parse error: ' + err.message });
        });



      } catch (err) {
        client.release();
        try { fs.unlinkSync(filePath); } catch(e) {}
        console.error('Database Error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Database error: ' + err.message });
      }
    } catch (err) {
      try { fs.unlinkSync(filePath); } catch(e) {}
      console.error('Server Error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Server error: ' + err.message });
    }
  });
  
  readStream.on('error', (err) => {
      try { fs.unlinkSync(filePath); } catch(e) {}
      if (!res.headersSent) res.status(500).json({ error: 'Error reading file' });
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
