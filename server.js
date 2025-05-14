import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import mysql from 'mysql';
import { JSDOM } from 'jsdom';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: 'root123',
  database: 'Chatbot5',
  port: 3306,
});

const app = express();
const PORT = 8080;

// Your API keys
const GNEWS_API_KEY   = "bb021a4b1e61649a484c577063faebf1";
const BASE_URL        = "https://gnews.io/api/v4/search";
const NEWSAPI_KEY     = "rhNuLNJxtMvLQ51twMz4alZVL5smy5F6eFrEd79r";
const NEWSAPI_BASE_URL= "https://api.thenewsapi.com/v1/news/all";

// Flask endpoints
const SUMMARIZE_URL   = "http://127.0.0.1:5000/summarize";
const REDUCE_BIAS_URL = "http://127.0.0.1:5000/reduce_bias";

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

db.connect(err => {
  if (err) console.error("DB connection error:", err);
});

// --- Chat & Message routes (unchanged) ---
app.get('/api/chats', (req, res) => {
  db.query('SELECT * FROM Chats ORDER BY last_updated DESC', (err, results) => {
    if (err) return res.status(500).end();
    res.json(results);
  });
});

app.post('/api/chats', (req, res) => {
  db.query('INSERT INTO Chats (title) VALUES (?)', [req.body.title], (err, result) => {
    if (err) return res.status(500).end();
    res.json({ id: result.insertId, title: req.body.title });
  });
});

app.get('/api/chats/:chatId/messages', (req, res) => {
  db.query('SELECT * FROM Messages WHERE chat_id = ? ORDER BY timestamp ASC',
    [req.params.chatId], (err, results) => {
      if (err) return res.status(500).end();
      res.json(results);
  });
});

app.post('/api/chats/:chatId/messages', (req, res) => {
  const { sender, content } = req.body;
  db.query('INSERT INTO Messages (chat_id, sender, content) VALUES (?, ?, ?)',
    [req.params.chatId, sender, content], (err, result) => {
      if (err) return res.status(500).end();
      db.query('UPDATE Chats SET last_updated = CURRENT_TIMESTAMP WHERE id = ?',
        [req.params.chatId], () => {
          res.json({ id: result.insertId, chat_id: req.params.chatId, sender, content });
      });
  });
});

// --- Helpers ---

// 1) Fallback via TheNewsAPI
async function fetchArticlesFallback(query) {
  try {
    const params = new URLSearchParams({
      api_token: NEWSAPI_KEY,
      search: query,
      language: 'en',
      limit: 6
    });
    const resp = await axios.get(`${NEWSAPI_BASE_URL}?${params}`);
    const list = resp.data.data || [];
    return list.map(a => ({ title: a.title, url: a.url }));
  } catch (err) {
    console.error("Fallback fetch failed:", err.message);
    return [];
  }
}

// 2) Primary via GNews
async function fetchArticles(query) {
  try {
    const params = new URLSearchParams({ q: query, lang: 'en', max: '6', apikey: GNEWS_API_KEY });
    const resp = await axios.get(`${BASE_URL}?${params}`);
    const arts = resp.data.articles || [];
    if (arts.length === 0) {
      return fetchArticlesFallback(query);
    }
    return arts.map(a => ({ title: a.title, url: a.url }));
  } catch (err) {
    console.error("GNews fetch failed:", err.message);
    return fetchArticlesFallback(query);
  }
}

// 3) Loose text extraction
async function extractText(url) {
  try {
    const resp = await axios.get(url);
    const dom  = new JSDOM(resp.data);
    const doc  = dom.window.document;
    // Strip common noise
    ['script','style','nav','footer','aside','.ads','.newsletter','.subscribe','.promo']
      .forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));
    // Grab any paragraphs ≥ 20 chars
    const paras = Array.from(doc.querySelectorAll('p'))
      .map(p => p.textContent.trim())
      .filter(t => t.length > 20)
      .slice(0, 30);
    return paras.join(' ').replace(/\s+/g, ' ').trim() || null;
  } catch (err) {
    console.error("Text extraction failed:", err.message);
    return null;
  }
}

// 4) Summarize via Flask (kept for compatibility)
async function generateSummary(text, max_length=200, min_length=150) {
  if (!text || text.length < 20) {
    return "Summary unavailable due to limited content.";
  }
  try {
    const resp = await axios.post(SUMMARIZE_URL,
      { text, max_length, min_length },
      { headers: { 'Content-Type':'application/json' } }
    );
    return resp.data.summary || 'Error generating summary';
  } catch (err) {
    console.error("Summarize error:", err.message);
    return 'Error generating summary';
  }
}

// 5) Neutralize bias via Flask (kept for compatibility)
async function generateNeutralSummary(text, max_length=200, min_length=150) {
  if (!text || text.length < 20) {
    return "Summary unavailable due to limited content.";
  }
  try {
    const resp = await axios.post(REDUCE_BIAS_URL,
      { text },
      { headers: { 'Content-Type':'application/json' } }
    );
    const neutralText = resp.data.neutral_text;
    return generateSummary(neutralText, max_length, min_length);
  } catch (err) {
    console.error("Bias reduction error:", err.message);
    return 'Error generating neutral summary';
  }
}

// --- Main chat endpoint with background processing, simulated progress, and typing ---
app.post('/chat', async (req, res) => {
  // Set content type to plain text so we can output our formatted text.
  res.setHeader('Content-Type', 'text/plain');

  const { chatId, message: user_input } = req.body;
  if (!user_input) {
    return res.json({ message: "Hello! Please enter a topic." });
  }

  // Initialize state if needed.
  if (!app.locals.userState) app.locals.userState = {};
  if (!app.locals.userState[chatId]) {
    app.locals.userState[chatId] = { stage: 'initial', topic: null, articles: [] };
  }
  const state = app.locals.userState[chatId];

  // Helper functions for delay and typing at 110ms per word.
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  // For progress messages.
  async function typeTextProgress(text) {
    const words = text.split(' ');
    for (const word of words) {
      res.write(word + ' ');
      await sleep(110);
    }
  }
  // For final output.
  async function typeTextFinal(text) {
    const words = text.split(' ');
    for (const word of words) {
      res.write(word + ' ');
      await sleep(110);
    }
  }

  // Start background processing: fetch articles and extract texts concurrently.
  const articlesPromise = (async () => {
    const rawArticles = await fetchArticles(user_input);
    const articles = [];
    for (let art of rawArticles) {
      const txt = await extractText(art.url);
      if (txt) articles.push({ title: art.title, content: txt });
      if (articles.length >= 3) break;
    }
    return articles;
  })();

  try {
    state.topic = user_input;
    state.stage = 'processing';

    // Simulated progress messages with ticks on the same line.
    await typeTextProgress("Fetching articles... ");
    await sleep(7000); // 7 seconds
    res.write("✓\n");

    const articles = await articlesPromise; // Wait for articles

    await typeTextProgress("Reducing bias... ");
    await sleep(10000); // 10 seconds
    res.write("✓\n");

    await typeTextProgress("Generating summaries... ");
    // Summarization happens as part of the next step

    if (articles.length === 0) {
      await typeTextProgress("No articles found. Please try a different topic.\n");
      return res.end();
    }

    // Generate individual article summaries concurrently.
    const summaryPromises = articles.map(async (article) => {
      const summaryPayload = {
        text: article.content,
        max_length: 100,
        min_length: 80,
      };
      const articleSummaryResp = await axios.post(SUMMARIZE_URL, summaryPayload, { responseType: 'stream' });
      let summaryText = "";
      await new Promise((resolve, reject) => {
        articleSummaryResp.data.on('data', chunk => {
          summaryText += chunk.toString();
        });
        articleSummaryResp.data.on('end', resolve);
        articleSummaryResp.data.on('error', reject);
      });
      return summaryText;
    });
    // Wait for all article summaries to finish.
    const articleSummaries = await Promise.all(summaryPromises);
    res.write("✓\n\n"); // Add tick and new lines after summaries are done

    // Now type out the final output.
    await typeTextFinal("**Unbiased Article Summaries:**\n\n");
    for (let i = 0; i < articles.length; i++) {
      await typeTextFinal(`**Article ${i + 1}: ${articles[i].title}**\n`);
      await typeTextFinal(articleSummaries[i] + "\n\n");
    }

    // Generate an overall summary based on the individual article summaries.
    await typeTextFinal("**Overall Summary:**\n");
    const combinedSummaries = articleSummaries.join(' ');
    // Send the rewrite flag to instruct the Flask endpoint to generate a rephrased summary.
    const overallPayload = { text: combinedSummaries, max_length: 200, min_length: 150, rewrite: true };
    const overallResp = await axios.post(SUMMARIZE_URL, overallPayload, { responseType: 'stream' });
    let overallSummary = "";
    await new Promise((resolve, reject) => {
      overallResp.data.on('data', chunk => {
        overallSummary += chunk.toString();
      });
      overallResp.data.on('end', resolve);
      overallResp.data.on('error', reject);
    });
    await typeTextFinal(overallSummary);

    // *** Modification: Persist the overall summary in the database ***
    db.query('UPDATE Chats SET overall_summary = ? WHERE id = ?', [overallSummary, chatId], (err) => {
      if (err) console.error("Error updating overall summary:", err);
    });

    state.stage = 'completed';
    return res.end();
  } catch (err) {
    console.error("Chat endpoint error:", err);
    res.write("Error: Internal server error.\n");
    return res.end();
  }
});

// Fallback to static UI.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.error(`Server listening on port ${PORT}`);
});
