

import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import mysql from 'mysql';
import { JSDOM } from 'jsdom';
import axios from 'axios';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: 'root123',
  database: 'Chatbot5',
  port: 3306,
});

const app = express();
const PORT = 8080;
const GNEWS_API_KEY = "bb021a4b1e61649a484c577063faebf1";
const BASE_URL = "https://gnews.io/api/v4/search";

// Flask API URLs
const SUMMARIZE_URL = "http://127.0.0.1:5000/summarize";
const REDUCE_BIAS_URL = "http://127.0.0.1:5000/reduce_bias";

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// User state management
const userState = {};

// Database connection
db.connect(err => {
  if (err) throw err;
  console.log('Connected to database');
});

// Routes 
app.get('/api/chats', (req, res) => {
  const query = 'SELECT * FROM Chats ORDER BY last_updated DESC';
  db.query(query, (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

app.post('/api/chats', (req, res) => {
  const { title } = req.body;
  const query = 'INSERT INTO Chats (title) VALUES (?)';
  db.query(query, [title], (err, result) => {
    if (err) throw err;
    res.json({ id: result.insertId, title });
  });
});

app.get('/api/chats/:chatId/messages', (req, res) => {
  const chatId = req.params.chatId;
  const query = 'SELECT * FROM Messages WHERE chat_id = ? ORDER BY timestamp ASC';
  db.query(query, [chatId], (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

app.post('/api/chats/:chatId/messages', (req, res) => {
  const chatId = req.params.chatId;
  const { sender, content } = req.body;
  const query = 'INSERT INTO Messages (chat_id, sender, content) VALUES (?, ?, ?)';
  db.query(query, [chatId, sender, content], (err, result) => {
    if (err) throw err;
    const updateChatQuery = 'UPDATE Chats SET last_updated = CURRENT_TIMESTAMP WHERE id = ?';
    db.query(updateChatQuery, [chatId], (err) => {
      if (err) throw err;
      res.json({ id: result.insertId, chat_id: chatId, sender, content });
    });
  });
});

// Function to fetch articles from GNews API 
async function fetchArticles(query) {
  try {
    const params = new URLSearchParams({ q: query, lang: 'en', max: '6', apikey: GNEWS_API_KEY });
    const response = await fetch(`${BASE_URL}?${params}`);
    const data = await response.json();
    if (response.status !== 200 || !data.articles) {
      throw new Error(`Error fetching articles: ${data.message || 'Unknown error'}`);
    }
    return data.articles;
  } catch (err) {
    console.error(err);
    return [];
  }
}

// Function to extract text from article URL (optimized)
async function extractText(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const dom = new JSDOM(text);
    const paragraphs = dom.window.document.querySelectorAll("p");
    let content = Array.from(paragraphs).map(p => p.textContent.trim()).join(" ");
    content = content.replace(/(e[-]?Edition|newsletter|subscribe|Get Morning Report|Get[\s\S]*?email|Today’s edition).*/gi, "").replace(/\s+/g, ' ').trim();
    if (content.length < 100) return null;
    return content;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Function to generate summaries using the Flask app
async function generateSummary(text, max_length = 200, min_length = 150) {
  try {
    const response = await axios.post(SUMMARIZE_URL, { text, max_length, min_length }, { headers: { 'Content-Type': 'application/json' } });
    return response.data.summary;
  } catch (err) {
    console.error(err);
    return 'Error generating summary';
  }
}

// Function to generate neutral summaries 
async function generateNeutralSummary(text) {
  try {
    const response = await axios.post(REDUCE_BIAS_URL, { text }, { headers: { 'Content-Type': 'application/json' } });
    const neutralText = response.data.neutral_text;
    return generateSummary(neutralText, 200, 150);
  } catch (err) {
    console.error(err);
    return 'Error generating neutral summary';
  }
}

app.post('/chat', async (req, res) => {
  const chatId = req.body.chatId;
  const user_input = req.body.message;

  if (!user_input) {
    return res.json({ message: "Hello! Please enter a topic." });
  }

  if (!userState[chatId]) {
    userState[chatId] = {
      stage: 'initial',
      topic: null,
      articles: [],
      neutralSummaries: [],
      neutralOverallSummary: null
    };
  }

  const currentState = userState[chatId];

  try {
    switch (currentState.stage) {
      case 'initial':
        currentState.topic = user_input;
        currentState.stage = 'fetchingArticles';

        // Fetch and extract articles
        const articles = await fetchArticles(user_input);
        currentState.articles = [];
        for (const article of articles) {
          const content = await extractText(article.url);
          if (content && currentState.articles.length < 3) {
            currentState.articles.push({ title: article.title, content });
          }
        }

        currentState.stage = 'generatingSummaries';

        // No res.json here! Just continue processing

        // Generate neutral summaries for articles (100 words each)
        const articlePromises = currentState.articles.map(async article => {
          const neutralSummary = await generateNeutralSummary(article.content, 100, 80);
          return { title: article.title, summary: neutralSummary };
        });
        const summarizedArticles = await Promise.all(articlePromises);

        // Generate overall summary (200 words)
        const combinedContent = currentState.articles.map(article => article.content).join(' ');
        const neutralOverallSummary = await generateNeutralSummary(combinedContent, 200, 150);

        // Prepare final response message
        let summaryMessage = '\n\n**Unbiased Article Summaries:**\n\n';
        summarizedArticles.forEach((item, index) => {
          summaryMessage += `**Article ${index + 1}: ${item.title}**\n${item.summary}\n\n`;
        });
        summaryMessage += `\n**Overall Summary:**\n${neutralOverallSummary}`;

        // Now send final response
        return res.json({ message: summaryMessage });

      default:
        return res.json({ message: "Conversation completed. Please start a new chat." });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "An error occurred while processing your request." });
  }
});


// Fallback to serve index.html 
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server (unchanged)
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});