SBOT: Intelligent News Summarization & Bias Reduction
An intelligent chatbot designed to provide users with unbiased, concise summaries of news articles. The chatbot achieves this by either summarizing user-submitted articles or retrieving and analyzing recent, relevant articles based on a user-specified topic.

Tech Stack
Frontend: HTML/CSS/JS with Bootstrap.

Backend: Node.js/Express for routing and state management alongside Flask for Python AI endpoints.

Database: MySQL for secure user data and chat history storage.

AI/ML: * DistilBART (Hugging Face) for Abstractive Summarization.

VADER & NLTK (WordNet) for Sentiment Analysis and Bias Reduction.

APIs: GNews API for fetching high-quality, real-time article data.


How It Works (The Pipeline)
Topic Input: The user submits a topic or article URL.

Data Fetching: The Express backend uses the GNews API to scrape at least three diverse articles, filtering out irrelevant metadata like newsletters or subscription prompts.

Summarization: The text is passed to a Flask endpoint running DistilBART. Hyperparameters (num_beams=4, length_penalty=2.0, no_repeat_ngram_size=3) are optimized to generate crisp 150-word individual summaries and a 200-word synthesized summary.

Bias Reduction: The output is split into sentences. VADER scores the sentiment of each sentence. If a sentence exceeds a bias threshold, WordNet is used to dynamically swap polarized words for neutral synonyms.

State Management: The entire flow is managed via an in-memory userState object keyed by unique chatIds.


Performance Highlights
Speed vs. Quality: By migrating from the 400M parameter BART model to the 150M parameter DistilBART, average response time was cut from 120 seconds to 90 seconds.

User-Tested: 80% of testers emphasized that speed is paramount, and 78% of respondents indicated that there was no discernible difference between the summaries produced by the heavier and lighter models.
