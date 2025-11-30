const fs = require('fs');
const csv = require('csv-parser');
const pool = require('../config/db');

const uploadFile = async (req, res) => {
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

  parser.on('error', (err) => {
      console.error('Error parsing CSV headers:', err);
      readStream.destroy();
      if (!res.headersSent) res.status(400).json({ error: 'Failed to parse CSV headers: ' + err.message });
  });

  // Wait for stream to close (which happens after destroy)
  readStream.on('close', async () => {
    // If headers were not found (empty file), handle it
    if (headers.length === 0) {
        try { fs.unlinkSync(filePath); } catch(e) {}
        return res.status(400).json({ error: 'Could not read headers from CSV' });
    }

    let client = null;
    const releaseClient = () => {
        if (client) {
            client.release();
            client = null;
        }
    };

    try {
      client = await pool.connect();

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
        try { fs.unlinkSync(filePath); } catch(e) {}
        releaseClient();
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
      
      console.log(`Unique columns for deduplication: ${availableUniqueCols.join(', ')}`);

      // Prepare Batch Insert
      const batchSize = 500;
      let batch = [];
      let totalInserted = 0;
      
      const processBatch = async (currentBatch) => {
          if (currentBatch.length === 0) return;
          console.log(`Processing batch of ${currentBatch.length} rows...`);

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
          }

          try {
              const res = await client.query(query, valuesData);
              totalInserted += res.rowCount;
          } catch (err) {
              console.error('Error inserting batch:', err);
              throw err;
          }
      };

      const fileStream = fs.createReadStream(filePath);
      const parserStream = fileStream.pipe(csv());

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
          console.log('CSV stream ended. Processing remaining batch...');
          try {
              if (batch.length > 0) {
                  await processBatch(batch);
              }
              console.log('Import completed. Rows inserted:', totalInserted);
              releaseClient();
              try { fs.unlinkSync(filePath); } catch(e) {}
              if (!res.headersSent) res.json({ message: `Successfully imported ${totalInserted} new rows into table: ${targetTable}` });
          } catch (err) {
              console.error('Batch Insert Error:', err);
              releaseClient();
              try { fs.unlinkSync(filePath); } catch(e) {}
              if (!res.headersSent) res.status(500).json({ error: 'Database error: ' + err.message });
          }
      });

      parserStream.on('error', (err) => {
           console.error('CSV Parse Error:', err);
           releaseClient();
           try { fs.unlinkSync(filePath); } catch(e) {}
           if (!res.headersSent) res.status(500).json({ error: 'CSV Parse error: ' + err.message });
      });

    } catch (err) {
      releaseClient();
      try { fs.unlinkSync(filePath); } catch(e) {}
      console.error('Server Error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Server error: ' + err.message });
    }
  });
  
  readStream.on('error', (err) => {
      try { fs.unlinkSync(filePath); } catch(e) {}
      if (!res.headersSent) res.status(500).json({ error: 'Error reading file' });
  });
};

module.exports = {
  uploadFile
};
