CREATE DATABASE IF NOT EXISTS Chatbot5;

USE Chatbot5;

-- Create the Chats table
CREATE TABLE IF NOT EXISTS Chats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create the Messages table
CREATE TABLE IF NOT EXISTS Messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chat_id INT NOT NULL,
  sender VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chat_id) REFERENCES Chats(id)
);
scp create_db.sql mnazi002@doc.gold.ac.uk:~/create_db.sql
