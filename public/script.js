let currentChatId = null;
let isProcessing = false; // Flag to track if processing is in progress

// Function to show loading message
function showLoading(chatId, message) {
  if (!currentChatId) return;

  // Add loading message to UI
  addMessage('bot', message);
  
  fetch(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: 'bot', content: message }),
  })
    .then(() => loadChatMessages(chatId))
    .catch(err => {
    });
}

// Fetch and display chat histories
function loadChatHistories() {
  fetch('/api/chats')
    .then(response => response.json())
    .then(chats => {
      const chatHistoryList = document.getElementById('chat-history-list');
      chatHistoryList.innerHTML = '';

      chats.forEach(chat => {
        const li = document.createElement('li');
        li.classList.add('p-2', 'border-bottom');
        li.dataset.chatId = chat.id;

        li.innerHTML = `
          <a href="#!" class="d-flex justify-content-between">
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

        li.addEventListener('click', () => {
          currentChatId = chat.id;
          document.getElementById('chat-title').textContent = chat.title;
          loadChatMessages(chat.id);
        });

        chatHistoryList.appendChild(li);
      });
    })
    .catch(err => {
    });
}

// Load messages for a chat
function loadChatMessages(chatId) {
  fetch(`/api/chats/${chatId}/messages`)
    .then(response => response.json())
    .then(messages => {
      const chatWindow = document.getElementById('chat-window');
      chatWindow.innerHTML = '';

      messages.forEach(message => {
        addMessage(message.sender, message.content, message.sender === 'bot');
      });

      chatWindow.scrollTop = chatWindow.scrollHeight;
    })
    .catch(err => {
    });
}

// Function to add formatted message to chat window
function addMessage(sender, content, isBotResponse = false) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("chat-message");
  messageDiv.classList.add(sender === "user" ? "bg-user" : "bg-bot");
  
  if (isBotResponse) {
    messageDiv.classList.add("markdown");
    content = content.replace(/\n/g, "<br>");
  }

  messageDiv.innerHTML = `
    <div class="message-timestamp small text-muted mb-1">
      ${new Date().toLocaleTimeString()}
    <div class="message-content">
      ${content}
    </div>
  `;

  document.getElementById('chat-window').appendChild(messageDiv);
}

// Handle sending messages
const sendButton = document.getElementById('sendButton');
const messageInput = document.getElementById('messageInput');

sendButton.addEventListener('click', () => {
  const messageText = messageInput.value.trim();
  if (messageText !== '' && currentChatId !== null && !isProcessing) {
    isProcessing = true; // Set processing flag

    // Add user's message to UI
    addMessage('user', messageText);
    messageInput.value = '';

    // Send user's message to API
    fetch(`/api/chats/${currentChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'user', content: messageText }),
    })
      .then(() => {
        // Show loading message
        addMessage('bot', "Processing your request...");

        // Simulate bot response
        return fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: messageText, chatId: currentChatId })
        });
      })
      .then(response => response.json())
      .then((data) => {
        // Replace loading message with actual bot response
        const botMessage = data.message;
        addMessage('bot', botMessage, true);

        // Save bot message to API
        fetch(`/api/chats/${currentChatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: 'bot', content: botMessage }),
        })
          .then(() => {
            isProcessing = false; // Reset processing flag
            loadChatMessages(currentChatId);
          })
          .catch(err => {
            isProcessing = false; // Reset processing flag on error
          });
      })
      .catch(err => {
        isProcessing = false; // Reset processing flag on error
      });
  }
});

// Handle starting a new chat  
const newChatBtn = document.getElementById('newChatBtn');

newChatBtn.addEventListener('click', () => {
  const chatTitle = prompt('Enter a title for the new chat:');
  if (chatTitle) {
    fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: chatTitle }),
    })
      .then(response => response.json())
      .then((chat) => {
        currentChatId = chat.id;
        document.getElementById('chat-title').textContent = chat.title;
        loadChatHistories();
        document.getElementById('chat-window').innerHTML = '';

        // Automatically send an initial (welcome) message
        return fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: "", chatId: chat.id })
        });
      })
      .then(response => response.json())
      .then((data) => {
        const botMessage = data.message;
        addMessage('bot', botMessage, true);
        
        fetch(`/api/chats/${currentChatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: 'bot', content: botMessage }),
        })
          .then(() => loadChatMessages(currentChatId))
          .catch(err => {
          });
      })
      .catch(err => {
      });
  }
});

// Initial load
loadChatHistories();
