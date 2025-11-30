const fs = require('fs');
const path = require('path');

async function uploadFile() {
    const filePath = path.join(__dirname, 'airlines.csv');
    // Create a dummy file if it doesn't exist
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, 'header1,header2\nval1,val2');
    }

    const formData = new FormData();
    const fileContent = fs.readFileSync(filePath);
    const blob = new Blob([fileContent], { type: 'text/csv' });
    formData.append('file', blob, 'airlines.csv');

    try {
        console.log('--- START UPLOAD ---');
        console.log('Uploading...');
        const response = await fetch('http://localhost:3000/upload', {
            method: 'POST',
            body: formData
        });
        console.log('Response status:', response.status);
        const text = await response.text();
        console.log('Response body:', text);
    } catch (error) {
        console.error('Error:', error);
    }
}

uploadFile();
