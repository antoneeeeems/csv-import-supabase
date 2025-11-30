# CSV to Supabase Importer

This project is a robust Node.js application designed to streamline the process of importing CSV data into a Supabase (PostgreSQL) database. It features a user-friendly web interface for file uploads and intelligent backend logic to map data to the correct database tables automatically.

## Features

-   **Automatic Table Detection**: The system analyzes CSV headers and matches them against existing tables in your public schema. If a table's columns match the CSV headers, the data is imported there.
-   **Smart Deduplication**: Utilizes PostgreSQL's `ON CONFLICT` clause. It detects Primary Keys and Unique constraints on the target table to prevent duplicate records from being inserted.
-   **Batch Processing**: Data is processed and inserted in batches (default: 500 rows) to ensure efficient memory usage and performance, even with larger files.
-   **Drag-and-Drop Interface**: A clean, modern frontend allows users to easily drag and drop CSV files for upload.
-   **Real-time Feedback**: The UI provides immediate status updates on the import process, including success messages with row counts or detailed error descriptions.

## Prerequisites

-   [Node.js](https://nodejs.org/) (v14 or higher recommended)
-   A [Supabase](https://supabase.com/) project or any PostgreSQL database.

## Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd CSV2Supa
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Set up your environment variables:
    Create a `.env` file in the root directory and add your database connection string:
    ```env
    DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
    ```

## Usage

1.  Start the server:
    ```bash
    node server.js
    ```

2.  Open your browser and navigate to:
    ```
    http://localhost:3000
    ```

3.  **Upload a CSV File**:
    -   Drag and drop a CSV file into the upload area.
    -   Ensure the CSV headers match the column names of a table in your Supabase database.
    -   Click "Import to Database".

## Project Structure

-   `server.js`: The main Express server handling file uploads, CSV parsing, and database insertion logic.
-   `public/`: Contains the frontend `index.html` with the drag-and-drop interface.
-   `initial csv imports/`: Contains sample CSV files for testing.
-   `initial sql statements/`: Contains SQL scripts for setting up sample tables in your database.

## How it Works

1.  **Upload**: The file is uploaded to the server using `multer`.
2.  **Header Analysis**: The server reads the first line of the CSV to get the headers.
3.  **Schema Matching**: It queries the database `information_schema` to find a table that contains all the columns present in the CSV headers.
4.  **Constraint Check**: It identifies unique constraints on the target table to handle duplicates safely.
5.  **Batch Insert**: The CSV is streamed and rows are inserted in batches using parameterized queries for security and speed.
6.  **Cleanup**: The uploaded file is deleted from the server after processing.

## Dependencies

-   `express`: Web server framework.
-   `pg`: PostgreSQL client for Node.js.
-   `multer`: Middleware for handling `multipart/form-data` (file uploads).
-   `csv-parser`: Streaming CSV parser.
-   `dotenv`: Loads environment variables.
