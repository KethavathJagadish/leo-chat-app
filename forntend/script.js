import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, getIdToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, collection, addDoc, query, orderBy, getDocs, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- CONFIG & API KEYS ---
const APP_VERSION = "4.1.0 (Secure Backend)";
const BACKEND_URL = "http://localhost:3000"; // URL for your local backend server

// ⚠️ IMPORTANT: Fill in your public-facing Firebase config here.
const firebaseConfig = {
  apiKey: "AIzaSyCzZ1u7HsDTWCdOuDE8Hiu1pyw5KtKN2bg",
  authDomain: "leo-personal-assistant.firebaseapp.com",
  projectId: "leo-personal-assistant",
  storageBucket: "leo-personal-assistant.firebasestorage.app",
  messagingSenderId: "39261347919",
  appId: "1:39261347919:web:ec19571bde253b22e3ca3a",
  measurementId: "G-X4WC6DDGHR"
};

// --- GLOBAL STATE ---
let db, auth, userId, provider;
let localChatHistory = [];
let currentConversationId = null;
let uploadedImageBase64 = null;
let originalImage = null;
let eventListenersInitialized = false;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupFirebase();
    document.getElementById('google-login-btn').addEventListener('click', () => signInWithPopup(auth, provider).catch(handleAuthError));
    document.getElementById('guest-login-btn').addEventListener('click', () => signInAnonymously(auth).catch(handleAuthError));
});

function handleAuthError(error) {
    console.error("Authentication Error:", error);
    document.getElementById('login-error-message').textContent = error.message;
}

// --- FIREBASE & AUTH SETUP ---
function setupFirebase() {
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        provider = new GoogleAuthProvider();
        onAuthStateChanged(auth, handleAuthStateChange);
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        document.getElementById('login-error-message').textContent = "Failed to initialize. Check console for details.";
    }
}

function handleAuthStateChange(user) {
    const loginPage = document.getElementById('login-page');
    const chatApp = document.getElementById('chat-app-container');
    if (user) {
        userId = user.uid;
        loginPage.classList.remove('active');
        chatApp.classList.add('active');
        document.getElementById('user-name').textContent = user.displayName || 'Guest';
        document.getElementById('user-avatar').src = user.photoURL || `https://ui-avatars.com/api/?name=${(user.displayName || 'G').charAt(0)}&background=000&color=fff&size=40`;
        initializeChatApp();
    } else {
        loginPage.classList.add('active');
        chatApp.classList.remove('active');
        eventListenersInitialized = false;
    }
}

function initializeChatApp() {
    if (eventListenersInitialized) return;

    document.getElementById('app-version').textContent = `LEO v${APP_VERSION}`;
    setupAppEventListeners();
    loadChatHistoryList();
    startNewChat();
    setupSidebarWeather();

    eventListenersInitialized = true;
}

// --- EVENT LISTENERS ---
function setupAppEventListeners() {
    document.getElementById('new-chat-btn').addEventListener('click', startNewChat);
    document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
    document.getElementById('chat-history-list').addEventListener('click', (e) => {
        const chatItem = e.target.closest('.chat-history-item');
        if (chatItem && chatItem.dataset.id !== currentConversationId) {
            loadConversation(chatItem.dataset.id);
        }
    });

    const slider = document.getElementById('temp-slider');
    const valueDisplay = document.getElementById('temp-value');
    slider.addEventListener('input', () => { valueDisplay.textContent = slider.value; });

    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const uploadBtn = document.getElementById('image-upload-btn');
    const uploadInput = document.getElementById('image-upload-input');
    const removeImgBtn = document.getElementById('remove-image-btn');

    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', handleImageUpload);
    removeImgBtn.addEventListener('click', removeUploadedImage);

    document.getElementById('filter-container').addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) applyFilter(e.target.dataset.filter);
    });

    const updateSendButtonState = () => {
        sendBtn.disabled = chatInput.value.trim().length === 0 && !uploadedImageBase64;
    };

    chatInput.addEventListener('input', updateSendButtonState);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) chatForm.requestSubmit();
        }
    });

    chatForm.addEventListener('submit', handleFormSubmit);

    document.getElementById('ai-chat-log').addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (card && card.dataset.prompt) {
            chatInput.value = card.dataset.prompt;
            updateSendButtonState();
            chatInput.focus();
        }
    });

    setupVoiceCommands();
}

// --- CORE CHAT LOGIC ---
async function handleFormSubmit(e) {
    e.preventDefault();
    const chatInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const prompt = chatInput.value.trim();

    if (!prompt && !uploadedImageBase64) return;

    if (document.querySelector('.welcome-screen')) {
        document.getElementById('ai-chat-log').innerHTML = '';
    }

    const currentImage = uploadedImageBase64 ? document.getElementById('image-preview').src : null;
    addMessageToLog(prompt, 'user', currentImage);

    const userMessageParts = [];
    if (uploadedImageBase64) {
        const mimeType = originalImage.split(';')[0].split(':')[1];
        userMessageParts.push({ inline_data: { mime_type: mimeType, data: uploadedImageBase64 } });
    }
    if (prompt) {
        userMessageParts.push({ text: prompt });
    }
    localChatHistory.push({ role: "user", parts: userMessageParts });
    
    const temperature = parseFloat(document.getElementById('temp-slider').value);

    removeUploadedImage();
    chatInput.value = '';
    sendBtn.disabled = true;

    const thinkingIndicator = addMessageToLog('...', 'assistant');

    try {
        const user = auth.currentUser;
        if (!user) throw new Error("User not logged in.");
        const token = await user.getIdToken();

        const response = await fetch(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                history: localChatHistory,
                temperature: temperature
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }

        const result = await response.json();
        if (!result.candidates?.[0]?.content?.parts) {
            throw new Error("Invalid API response format.");
        }

        const text = result.candidates[0].content.parts[0].text;
        thinkingIndicator.remove();
        addMessageToLog(text, 'assistant');
        localChatHistory.push(result.candidates[0].content);

    } catch (error) {
        console.error("Chat Error:", error);
        if (thinkingIndicator) thinkingIndicator.remove();
        addMessageToLog(`Sorry, I ran into an error: ${error.message}.`, 'assistant');
    } finally {
        chatInput.focus();
    }
}

// --- UI & RENDER FUNCTIONS ---
function addMessageToLog(text, sender, imgSrc = null) {
    const chatLog = document.getElementById('ai-chat-log');
    const wrapper = document.getElementById('chat-log-wrapper');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    
    const avatarSrc = sender === 'user'
        ? document.getElementById('user-avatar').src
        : 'https://placehold.co/40x40/f0f0e6/000?text=L';
    
    let bubbleContent;
    if (sender === 'assistant' && text === '...') {
        bubbleContent = `<div class="thinking-indicator"><div></div><div></div><div></div></div>`;
    } else {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${sender}`;
        if (imgSrc) {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.className = 'message-image';
            bubble.appendChild(img);
        }
        if (text) {
             const textContent = document.createElement('div');
             textContent.innerHTML = sender === 'assistant' ? marked.parse(text) : text;
             bubble.appendChild(textContent);
        }
        bubbleContent = bubble.outerHTML;
    }

    messageDiv.innerHTML = `
        <img src="${avatarSrc}" alt="${sender} avatar" class="chat-avatar">
        ${bubbleContent}
    `;
    chatLog.appendChild(messageDiv);
    wrapper.scrollTop = wrapper.scrollHeight;
    return messageDiv;
}

function renderWelcomeScreen() {
    const chatLog = document.getElementById('ai-chat-log');
    chatLog.innerHTML = `
        <div class="welcome-screen">
            <div class="welcome-logo">LEO</div>
            <p class="welcome-tagline">How can I help you today?</p>
            <div class="suggestion-cards">
                <div class="card" data-prompt="Explain quantum computing in simple terms">
                    <h3>Explain quantum computing</h3>
                    <p>in simple, easy to understand terms.</p>
                </div>
                <div class="card" data-prompt="Suggest some ideas for a 10-year-old's birthday party">
                    <h3>Party Ideas</h3>
                    <p>for a 10-year-old's birthday.</p>
                </div>
                <div class="card" data-prompt="Write a Python script to sort a list of numbers">
                    <h3>Write Python Code</h3>
                    <p>to sort a list of numbers efficiently.</p>
                </div>
                <div class="card" data-prompt="What are some healthy and quick dinner recipes?">
                    <h3>Healthy Dinner Recipes</h3>
                    <p>that are quick to make on a weeknight.</p>
                </div>
            </div>
        </div>`;
}

function startNewChat() {
    currentConversationId = null;
    localChatHistory = [];
    document.getElementById('ai-chat-log').innerHTML = '';
    renderWelcomeScreen();
    removeUploadedImage();
    document.getElementById('prompt-input').value = '';
    document.getElementById('send-btn').disabled = true;
    updateActiveChatInList(null);
}

// --- CONVERSATION MANAGEMENT ---
// Note: Firestore saving logic is simplified in this version.
function loadChatHistoryList() { /* Placeholder */ }
async function loadConversation(conversationId) { /* Placeholder */ }
function updateActiveChatInList(conversationId) { /* Placeholder */ }

// --- FEATURE IMPLEMENTATIONS ---
function setupSidebarWeather() {
    if (!navigator.geolocation) {
        document.getElementById('weather-desc').textContent = 'Geolocation is not supported.';
        return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        const apiUrl = `${BACKEND_URL}/api/weather?lat=${latitude}&lon=${longitude}`;
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("User not logged in.");
            const token = await user.getIdToken();

            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error('Weather data unavailable.');
            const data = await response.json();
            document.getElementById('weather-temp').textContent = `${Math.round(data.main.temp)}°C`;
            document.getElementById('weather-city').textContent = data.name;
            document.getElementById('weather-desc').textContent = data.weather[0].description;
            document.getElementById('weather-icon').src = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
        } catch (error) {
            console.error('Weather Fetch Error:', error);
            document.getElementById('weather-desc').textContent = 'Could not fetch weather.';
        }
    }, () => {
        document.getElementById('weather-desc').textContent = 'Location access denied.';
    });
}

function setupVoiceCommands() {
    const micBtn = document.getElementById('mic-btn');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        micBtn.style.display = 'none';
        return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => micBtn.classList.add('mic-active');
    recognition.onend = () => micBtn.classList.remove('mic-active');
    recognition.onerror = (e) => console.error('Speech Recognition Error:', e.error);

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        document.getElementById('prompt-input').value += transcript;
        document.getElementById('send-btn').disabled = false;
    };

    micBtn.addEventListener('click', () => {
        if (micBtn.classList.contains('mic-active')) {
            recognition.stop();
        } else {
            recognition.start();
        }
    });
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        originalImage = e.target.result;
        uploadedImageBase64 = e.target.result.split(',')[1];
        
        document.getElementById('image-preview').src = e.target.result;
        document.getElementById('image-preview-container').style.display = 'block';
        document.getElementById('filter-container').style.display = 'flex';
        document.getElementById('send-btn').disabled = false;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function removeUploadedImage() {
    uploadedImageBase64 = null;
    originalImage = null;
    document.getElementById('image-preview').src = '';
    document.getElementById('image-preview-container').style.display = 'none';
    document.getElementById('filter-container').style.display = 'none';
    document.getElementById('send-btn').disabled = document.getElementById('prompt-input').value.trim().length === 0;
}

function applyFilter(filterType) {
    if (!originalImage) return;

    const canvas = document.getElementById('image-canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        if (filterType === 'reset') {
            ctx.filter = 'none';
        } else {
            ctx.filter = `${filterType}(1)`;
        }
        ctx.drawImage(img, 0, 0);
        const filteredImageDataUrl = canvas.toDataURL('image/jpeg');
        document.getElementById('image-preview').src = filteredImageDataUrl;
        uploadedImageBase64 = filteredImageDataUrl.split(',')[1];
    };
    img.src = originalImage;
}