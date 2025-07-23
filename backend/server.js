const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin');

// --- INITIALIZE FIREBASE ADMIN ---
// This uses the service account key you downloaded
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
// ---

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- AUTHENTICATION MIDDLEWARE ---
// This function will run before any protected endpoint
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send('Unauthorized: No token provided.');
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // Verify the token using the Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; // Add user info to the request object
    next(); // Token is valid, proceed to the next function (the API call)
  } catch (error) {
    console.error('Error while verifying Firebase ID token:', error);
    res.status(403).send('Unauthorized: Invalid token.');
  }
};
// ---

// --- PROTECTED API ENDPOINTS ---
// We add the 'verifyFirebaseToken' middleware to each route we want to protect.
app.post('/api/chat', verifyFirebaseToken, async (req, res) => {
    // The chat logic remains the same
    // We know req.user exists because the middleware passed
    console.log('Request from user UID:', req.user.uid); // You can now access the user's ID
    try {
        const { history, temperature } = req.body;
        const geminiApiKey = process.env.GEMINI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`;
        const response = await axios.post(apiUrl, { contents: history, generationConfig: { temperature } });
        res.json(response.data);
    } catch (error) {
        console.error("Error in /api/chat:", error.response ? error.response.data.error : error.message);
        res.status(500).json({ error: "Failed to get response from AI." });
    }
});

app.get('/api/weather', verifyFirebaseToken, async (req, res) => {
    // The weather logic remains the same
    try {
        const { lat, lon } = req.query;
        const weatherApiKey = process.env.WEATHER_API_KEY;
        const apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${weatherApiKey}&units=metric`;
        const response = await axios.get(apiUrl);
        res.json(response.data);
    } catch (error) {
        console.error("Error in /api/weather:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Failed to fetch weather data." });
    }
});
// ---

app.listen(PORT, () => {
    console.log(`🚀 LEO Backend Server is running on http://localhost:${PORT}`);
});