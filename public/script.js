let currentChatId = null;

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
      console.error('Error fetching chat history:', err);
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
        const li = document.createElement('li');
        li.classList.add('d-flex', 'chat-message', message.sender === 'user' ? 'justify-content-end' : 'justify-content-start');

        li.innerHTML = `
          <div class="message-content">
            <p class="small mb-1 text-muted">${new Date(message.timestamp).toLocaleTimeString()}</p>
            <p class="mb-0">${message.content}</p>
          </div>
        `;

        chatWindow.appendChild(li);
      });

      // Scroll to the bottom
      chatWindow.scrollTop = chatWindow.scrollHeight;
    })
    .catch(err => {
      console.error('Error fetching messages:', err);
    });
}

// Handle sending messages
const sendButton = document.getElementById('sendButton');
const messageInput = document.getElementById('messageInput');

sendButton.addEventListener('click', () => {
  const messageText = messageInput.value.trim();
  if (messageText !== '' && currentChatId !== null) {
    fetch(`/api/chats/${currentChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'user', content: messageText })
    })
      .then(response => response.json())
      .then(() => {
        messageInput.value = '';
        loadChatMessages(currentChatId);

        fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: currentChatId, message: messageText })
        })
          .then(response => response.json())
          .then(data => {
            if (data.messages) {
              data.messages.forEach(botMessage => {
                fetch(`/api/chats/${currentChatId}/messages`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sender: 'bot',
                    content: botMessage
                  })
                })
                  .then(() => loadChatMessages(currentChatId))
                  .catch(err => {
                    console.error(err);
                  });
              });
            }
          })
          .catch(err => {
            console.error(err);
          });
      })
      .catch(err => {
        console.error(err);
      });
  }
});

// Handle starting a new chat
const newChatBtn = document.getElementById('newChatBtn');

newChatBtn.addEventListener('click', () => {
  const chatTitle = prompt('Enter a title for the new chat:');
  if (chatTitle === null) return;

  fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: chatTitle }),
  })
    .then(response => response.json())
    .then(chat => {
      currentChatId = chat.id;
      document.getElementById('chat-title').textContent = chat.title;
      loadChatHistories();
      document.getElementById('chat-window').innerHTML = '';

      // Automatically send an initial message to get the welcome message from the bot
      fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: currentChatId, message: '' }),
      })
        .then(response => response.json())
        .then(data => {
          data.messages.forEach(botMessage => {
            fetch(`/api/chats/${currentChatId}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sender: 'bot', content: botMessage }),
            })
              .then(() => loadChatMessages(currentChatId))
              .catch(err => {
                console.error('Error sending bot message:', err);
              });
          });
        })
        .catch(err => {
          console.error('Error fetching bot response:', err);
        });
    })
    .catch(err => {
      console.error('Error creating new chat:', err);
    });
});

// Initial load
loadChatHistories();