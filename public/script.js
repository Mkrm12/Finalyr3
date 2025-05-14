// script.js

// DOM references
const messageInput = document.getElementById('messageInput');
const sendButton   = document.getElementById('sendButton');
const newChatBtn   = document.getElementById('newChatBtn');
const ttsFooter    = document.getElementById('tts-footer');
const ttsButton    = document.getElementById('ttsButton');
const stopButton   = document.getElementById('stopButton');

let currentChatId = null;
let isProcessing  = false;
let overallSummaryText = '';
let ttsUtterance = null;

// TTS configuration (change these to pick voice & speed)
const TTS_VOICE = 'Google UK English Male';  // e.g. 'Google US English'
const TTS_RATE  = 1.0;                       // 0.1 (slow) to 10 (fast)

/**
 * Append a message to the chat window
 */
function addMessage(sender, content, isBotMarkdown = false) {
  const chatWindow = document.getElementById('chat-window');
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('chat-message', sender === 'user' ? 'bg-user' : 'bg-bot');

  if (isBotMarkdown) {
    messageDiv.classList.add('markdown');
    content = content.replace(/\n/g, '<br>');
  }

  const timestampDiv = document.createElement('div');
  timestampDiv.classList.add('message-timestamp', 'small', 'text-muted', 'mb-1');
  timestampDiv.textContent = new Date().toLocaleTimeString();

  const contentDiv = document.createElement('div');
  contentDiv.classList.add('message-content');
  if (isBotMarkdown) contentDiv.innerHTML = content;
  else contentDiv.textContent = content;

  messageDiv.append(timestampDiv, contentDiv);
  chatWindow.appendChild(messageDiv);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/**
 * Load and render chat history list
 */
async function loadChatHistories() {
  try {
    const response = await fetch('/api/chats');
    const chats    = await response.json();
    const list     = document.getElementById('chat-history-list');
    list.innerHTML = '';
    chats.forEach(chat => {
      const li = document.createElement('li');
      li.classList.add('p-2', 'border-bottom');
      li.dataset.chatId = chat.id;
      li.innerHTML = `
        <a href="#" class="d-flex justify-content-between">
          <div class="d-flex flex-row">
            <div class="pt-1">
              <p class="fw-bold mb-0">${chat.title}</p>
            </div>
          </div>
          <div class="pt-1">
            <p class="small text-muted mb-1">${new Date(chat.last_updated).toLocaleString()}</p>
          </div>
        </a>
      `;
      li.addEventListener('click', () => selectChat(chat));
      list.appendChild(li);
    });
  } catch (err) {
    console.error('Failed to load chat histories:', err);
  }
}

/**
 * Select a chat and load its messages
 * - Also extracts and applies the overall summary from the DB,
 *   so that even on old chats the TTS functionality works.
 */
async function selectChat(chat) {
  currentChatId = chat.id;
  document.getElementById('chat-title').textContent = chat.title;
  
  // If the overall_summary field exists in the chat object, use it.
  overallSummaryText = chat.overall_summary ? chat.overall_summary.trim() : '';
  
  // Display or hide the TTS footer based on availability of summary.
  ttsFooter.style.display = overallSummaryText ? 'flex' : 'none';
  
  await loadChatMessages(chat.id);
}

/**
 * Load and render messages for a given chat
 */
async function loadChatMessages(chatId) {
  try {
    const response = await fetch(`/api/chats/${chatId}/messages`);
    const messages = await response.json();
    const win = document.getElementById('chat-window');
    win.innerHTML = '';
    messages.forEach(msg => {
      addMessage(msg.sender, msg.content, msg.sender === 'bot');
    });
  } catch (err) {
    console.error('Failed to load chat messages:', err);
  }
}

/**
 * Send user message, stream bot response, update UI, save, and handle TTS footer
 */
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isProcessing || currentChatId === null) return;
  isProcessing = true;

  addMessage('user', text);
  messageInput.value = '';

  try {
    // Save user message
    await fetch(`/api/chats/${currentChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'user', content: text })
    });

    // Create an empty bot bubble
    const botDiv = document.createElement('div');
    botDiv.classList.add('chat-message', 'bg-bot', 'markdown');
    botDiv.innerHTML = `
      <div class="message-timestamp small text-muted mb-1">${new Date().toLocaleTimeString()}</div>
      <div class="message-content"></div>
    `;
    const contentDiv = botDiv.querySelector('.message-content');
    document.getElementById('chat-window').appendChild(botDiv);

    // Stream response
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, chatId: currentChatId })
    });
    if (!res.ok || !res.body) throw new Error('Streaming failed');

    const reader  = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let botMsg    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true }).replace(/^data:\s*/, '');
      botMsg += chunk;
      contentDiv.innerHTML = botMsg.replace(/\n/g, '<br>');
      document.getElementById('chat-window').scrollTop =
        document.getElementById('chat-window').scrollHeight;
    }

    // Save bot message
    await fetch(`/api/chats/${currentChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'bot', content: botMsg })
    });

    // Extract overall summary text from the streaming message.
    const marker = '**Overall Summary:**';
    overallSummaryText = botMsg.includes(marker)
      ? botMsg.split(marker)[1].trim()
      : '';

    // Show or hide the TTS footer based on the overall summary.
    ttsFooter.style.display = overallSummaryText ? 'flex' : 'none';

  } catch (err) {
    console.error('Error in sendMessage:', err);
    const botContainer = document.querySelector('.bg-bot .message-content');
    if (botContainer) {
      botContainer.innerHTML = '<em style="color:red;">[Streaming failed]</em>';
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Initialize event listeners
 */
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
newChatBtn.addEventListener('click', async () => {
  const chatTitle = prompt('Enter a title for the new chat:');
  if (!chatTitle) return;

  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: chatTitle })
  });
  const chat = await res.json();
  await loadChatHistories();
  await selectChat(chat);

  const welcomeRes = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '', chatId: chat.id })
  });
  const { message: welcomeMsg } = await welcomeRes.json();
  addMessage('bot', welcomeMsg, true);
  await fetch(`/api/chats/${chat.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: 'bot', content: welcomeMsg })
  });
});

// TTS controls
ttsButton.addEventListener('click', () => {
  if (!overallSummaryText) return;
  
  // Cancel any ongoing speech before starting fresh.
  speechSynthesis.cancel();
  
  ttsUtterance = new SpeechSynthesisUtterance(overallSummaryText);
  ttsUtterance.voice = speechSynthesis.getVoices().find(v => v.name === TTS_VOICE);
  ttsUtterance.rate = TTS_RATE;
  ttsUtterance.onend = () => {
    ttsUtterance = null;
  };
  speechSynthesis.speak(ttsUtterance);
});

stopButton.addEventListener('click', () => {
  if (ttsUtterance) {
    speechSynthesis.cancel();
  }
});

// Initial load
loadChatHistories();
