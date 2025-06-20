const express = require('express');
const fs = require('fs');
const app = express();
const port = 3000;
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const fetch = require('node-fetch-commonjs');
const bodyParser = require('body-parser');
const cors = require('cors');
const https = require('https');

const captchaSecretKey = `--placeholder--`; // Replace with your actual CAPTCHA secret key

// Rate limits
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30, // Limit each IP to 30 requests per window
  standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
});

// https
const cts = { cert: fs.readFileSync("./fullchain.pem"), key: fs.readFileSync("./privkey.pem") }

// Middleware
app.use(express.static("static", { extensions: ['html'] }));
app.use(limiter);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

// Movies data loading
let movies = [];

try {
  const data = fs.readFileSync('movies.json', 'utf8');
  movies = JSON.parse(data);
} catch (err) {
  console.error('Error reading movies.json:', err);
}

// Send a message to webhook
async function sendWebhook(message) {
  fetch("https://discord.com/api/webhooks/--placeholder--", {
    body: JSON.stringify({
      content: message,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
    .then((res) => {
      console.log(res);
    })
    .catch((res) => {
      console.log(res);
    });
}

// Verify reCAPTCHA
async function verifyRecaptcha(responseToken) {
  const url = 'https://www.google.com/recaptcha/api/siteverify';
  
  const body = new URLSearchParams();
  body.append('secret', captchaSecretKey);
  body.append('response', responseToken);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error verifying reCAPTCHA:', error);
    throw error;
  }
}

// Endpoint: /list?amount=10
app.get('/list', (req, res) => {
  const amount = parseInt(req.query.amount);
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: 'An invalid token was provided' });
  }

  fs.readFile('keys.txt', 'utf8', (err, data) => { 
    if (err) {
      console.error('Error reading file:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    if (!data.includes(token)) {
      return res.status(401).json({ error: 'An invalid token was provided' });
    }

    if (isNaN(amount) || amount < 1) {
      return res.status(400).json({ error: 'Invalid amount parameter' });
    }

    const shuffled = movies.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, amount);
    res.json(selected);
  });
});

// Endpoint: /find?query=searchTerm
app.get('/find', (req, res) => {
  const query = req.query.query?.toLowerCase();
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: 'An invalid token was provided' });
  }

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  fs.readFile('keys.txt', 'utf8', (err, data) => { 
    if (err) {
      console.error('Error reading file:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!data.includes(token)) {
      return res.status(401).json({ error: 'An invalid token was provided' });
    }

    const results = movies.filter(movie =>
      movie.name?.toLowerCase().includes(query) ||
      movie.genres?.toLowerCase().includes(query) ||
      movie.description?.toLowerCase().includes(query)
    );

    res.json(results);
  });
});

// Endpoint: /request
app.get('/request', (req, res) => {
  const query = req.query.query?.toLowerCase();
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  sendWebhook("New database addition request: " + query);
	
  if (req.accepts('json')) {
    res.status(200).json("Send request.");
  } else {
    res.sendFile(__dirname + '/static/requested.html');
  }
});

// Endpoint: /get-key (POST)
app.post('/get-key', (req, res) => {
  const token = crypto.randomBytes(40).toString('hex');
  
  if (!req.body['g-recaptcha-response']) {
    return res.json({ "responseCode": 1, "responseDesc": "Validate captcha first" });
  }

  const RESPONSE_TOKEN = req.body['g-recaptcha-response'];

  verifyRecaptcha(RESPONSE_TOKEN)
    .then(result => {
      console.log('reCAPTCHA verification result:', result);
      if (result.success) {
        fs.appendFile('keys.txt', token + "\n", (err) => {
          if (err) {
            console.error('Error appending to file:', err);
            return res.status(500).json({ error: 'Failed to generate token' });
          }
          // Send webhook after token is saved
          sendWebhook("New API token generated: " + token);
          res.status(200).json({ token: token });
        });
      } else {
        console.log('Verification failed:', result['error-codes']);
        res.status(500).json({ error: 'Verification failed', details: result['error-codes'] });
      }
    })
    .catch(error => {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });
});

https.createServer(cts, app).listen(2025, () => {
  console.log('HTTPS server is running at port 2025');
});