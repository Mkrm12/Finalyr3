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

// Function to extract text from article URL
async function extractText(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const dom = new JSDOM(text);
    const paragraphs = dom.window.document.querySelectorAll("p");
    let content = Array.from(paragraphs).map(p => p.textContent.trim()).join(" ");
    content = content.replace(/(e[-]?Edition|newsletter|subscribe|Get Morning Report|Get[\s\S]*?email|Today’s edition).*/gi, "").replace(/\s+/g, ' ').trim();
    return content.split(' ').length > 50 ? content : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Function to generate summaries using the Flask app
async function generateSummary(text, max_length = 200, min_length = 150) {
  try {
    const response = await axios.post(
      'http://127.0.0.1:5000/summarize',
      { text, max_length, min_length },
      { headers: { 'Content-Type': 'application/json' } }
    );
    return response.data.summary;
  } catch (err) {
    console.error(err);
    return 'Error generating summary';
  }
}

// Function to generate neutral summaries
async function generateNeutralSummary(text) {
  try {
    const response = await axios.post(
      'http://127.0.0.1:5000/reduce_bias',
      { text },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const neutralText = response.data.neutral_text;
    return generateSummary(neutralText, 200, 150);
  } catch (err) {
    console.error(err);
    return 'Error generating neutral summary';
  }
}

// Chatbot endpoint
app.post('/chat', async (req, res) => {
  const chatId = req.body.chatId;
  const user_input = req.body.message.trim(); // Ensure leading/trailing spaces are removed

  if (!user_input) {
    return res.json({ messages: ["Hello! Please enter a topic."] });
  }

  if (!userState[chatId]) {
    userState[chatId] = {
      stage: 'initial',
      topic: null,
      summaryType: null,
      articles: [],
      summaries: [],
      neutralSummaries: [],
      overallSummary: null,
      neutralOverallSummary: null
    };
  }

  const currentState = userState[chatId];
  let messages = [];

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

        currentState.stage = 'displayArticles';

        // Prepare article messages
        currentState.articles.forEach(article => {
          const excerpt = article.content.split(' ').slice(0, 100).join(' '); // Adjusted to 100 words for brevity
          messages.push(`**${article.title}**\n${excerpt}\n---`);
        });

        messages.push(
          "Would you like a *generic* summary or an *unbiased* summary?"
        );

        return res.json({ messages });

      case 'displayArticles':
        const summaryType = user_input.toLowerCase();
        if (!['generic', 'unbiased'].includes(summaryType)) {
          messages.push("Please choose either *generic* or *unbiased*.");
          return res.json({ messages });
        }

        currentState.summaryType = summaryType;
        currentState.stage = 'generatingSummaries';

        currentState.summaries = await Promise.all(
          currentState.articles.map(article =>
            generateSummary(article.content, 200, 150)
          )
        );

        currentState.overallSummary = await generateSummary(
          currentState.summaries.join(' '),
          500,
          300
        );

        currentState.neutralSummaries = [];
        if (summaryType === 'unbiased') {
          currentState.neutralSummaries = await Promise.all(
            currentState.articles.map(article =>
              generateNeutralSummary(article.content)
            )
          );
          currentState.neutralOverallSummary = await generateSummary(
            currentState.neutralSummaries.join(' '),
            500,
            300
          );
        }

        currentState.stage = 'displaySummaries';

        // Prepare article summaries
        currentState.summaries.forEach((summary, index) => {
          messages.push(`**Article ${index + 1}**\n${summary}\n---`);
        });
        messages.push(`**Overall Summary**\n${currentState.overallSummary}`);

        if (summaryType === 'unbiased') {
          currentState.neutralSummaries.forEach((summary, index) => {
            messages.push(
              `**Unbiased Article ${index + 1}**\n${summary}\n---`
            );
          });
          messages.push(
            `**Unbiased Overall Summary**\n${currentState.neutralOverallSummary}`
          );
        }

        return res.json({ messages });

      default:
        messages.push("Conversation completed. Please start a new chat.");
        return res.json({ messages });
    }
  } catch (err) {
    console.error(err);
    messages = ["An error occurred while processing your request."];
    return res.json({ messages });
  }
});

// Fallback to serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});