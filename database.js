import mysql from 'mysql';

// Create the database connection
const db = mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: 'root123',
    database: 'Chatbot5',
    port: 3306,
});

// Connect to the database
db.connect((err) => {
    if (err) {
        console.error('DB connection failed:', err.stack);
        return;
    }
    console.log('Connected to database');
});

export default db;