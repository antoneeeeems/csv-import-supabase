require('dotenv').config();
const express = require('express');
const path = require('path');
const uploadRoutes = require('./routes/uploadRoutes');

const app = express();

// Global error handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

app.use(express.static(path.join(__dirname, '../public')));

app.use('/', uploadRoutes);

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global Error Handler:', err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({ error: 'An unexpected error occurred: ' + (err.message || err) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
