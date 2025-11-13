// --- server.js ---
// Refactored to use MongoDB instead of data.json

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const axios = require('axios');
require('dotenv').config();

const logger = require('./logger');
const { connectDB, getDb } = require('./database'); // Import DB functions

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Your index.html should be in a 'public' folder

// Email setup
let transporter;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  logger.success('Email configured');
} else {
  logger.warn('Email not configured. EMAIL_USER or EMAIL_PASS missing.');
}

// Twilio setup
let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  logger.success('Twilio configured: ' + process.env.TWILIO_PHONE_NUMBER);
} else {
  logger.error('Twilio NOT configured - SMS will not work!');
}

async function fetchContests() {
  const contests = [];
  
  try {
    const cfResponse = await axios.get('https://codeforces.com/api/contest.list');
    if (cfResponse.data.status === 'OK') {
      const upcomingCF = cfResponse.data.result
        .filter(c => c.phase === 'BEFORE')
        .map(c => ({
          platform: 'Codeforces',
          name: c.name,
          startTime: new Date(c.startTimeSeconds * 1000),
          duration: c.durationSeconds / 3600,
          url: `https://codeforces.com/contest/${c.id}`
        }));
      contests.push(...upcomingCF);
    }
  } catch (error) {
    logger.error('Error fetching Codeforces', error.message);
  }

  try {
    const ccResponse = await axios.get('https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all');
    if (ccResponse.data.future_contests) {
      const upcomingCC = ccResponse.data.future_contests.map(c => ({
        platform: 'CodeChef',
        name: c.contest_name,
        startTime: new Date(c.contest_start_date_iso),
        duration: (new Date(c.contest_end_date_iso) - new Date(c.contest_start_date_iso)) / (1000 * 3600),
        url: `https://www.codechef.com/${c.contest_code}`
      }));
      contests.push(...upcomingCC);
    }
  } catch (error) {
    logger.error('Error fetching CodeChef', error.message);
  }

  try {
    const lcResponse = await axios.post('https://leetcode.com/graphql', {
      query: `{
        allContests {
          title
          titleSlug
          startTime
          duration
        }
      }`
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (lcResponse.data?.data?.allContests) {
      const now = Date.now() / 1000;
      const upcomingLC = lcResponse.data.data.allContests
        .filter(c => c.startTime > now)
        .map(c => ({
          platform: 'LeetCode',
          name: c.title,
          startTime: new Date(c.startTime * 1000),
          duration: c.duration / 3600,
          url: `https://leetcode.com/contest/${c.titleSlug}`
        }));
      contests.push(...upcomingLC);
    }
  } catch (error) {
    logger.error('Error fetching LeetCode', error.message);
  }

  // TODO: Add AtCoder fetch logic here if you have an API for it

  contests.sort((a, b) => a.startTime - b.startTime);
  return contests;
}

async function sendEmail(to, subject, html) {
  if (!transporter) {
    logger.warn('Email not configured, skipping send.');
    return false;
  }
  try {
    await transporter.sendMail({
      from: `"CodeSync" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html
    });
    logger.success('Email sent to ' + to);
    return true;
  } catch (error) {
    logger.error('Email failed: ' + error.message);
    return false;
  }
}

async function sendSMS(to, message) {
  logger.sms('Sending SMS to ' + to);
  if (!twilioClient) {
    logger.error('Twilio not configured! Skipping SMS.');
    return false;
  }
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    logger.success('SMS sent! SID: ' + result.sid);
    return true;
  } catch (error) {
    logger.error('SMS failed: ' + error.message);
    return false;
  }
}

async function checkAndSendReminders() {
  logger.cron('Checking reminders...');
  
  try {
    const db = getDb(); // Get the connected DB instance
    const subscribersCol = db.collection('subscribers');
    const contestsCol = db.collection('contests');

    const contests = await fetchContests();
    
    // Update the contest list in the DB
    await contestsCol.deleteMany({}); // Clear old contests
    if (contests.length > 0) {
        await contestsCol.insertMany(contests); // Insert new ones
    }
    logger.cron(`Fetched and saved ${contests.length} contests.`);

    const subscribers = await subscribersCol.find().toArray();
    if (subscribers.length === 0) {
        logger.cron('No subscribers found. Skipping reminder check.');
        return;
    }
    logger.cron(`Checking reminders for ${subscribers.length} subscribers...`);

    const now = new Date();
    
    for (const contest of contests) {
      const hoursUntilStart = (new Date(contest.startTime) - now) / (1000 * 3600);
      
      // 24 hour reminder
      if (hoursUntilStart > 23 && hoursUntilStart < 25) {
        logger.info('Contest in 24h: ' + contest.name);
        for (const subscriber of subscribers) {
          if (subscriber.preferences.includes('email')) {
            await sendEmail(subscriber.email, `Contest Tomorrow: ${contest.name}`, generate24HourEmail(contest));
          }
          if (subscriber.preferences.includes('sms') && subscriber.phone) {
            await sendSMS(subscriber.phone, `Contest Tomorrow: ${contest.name} on ${contest.platform} at ${new Date(contest.startTime).toLocaleString()}. ${contest.url}`);
          }
        }
      }
      
      // 1 hour reminder
      if (hoursUntilStart > 0.5 && hoursUntilStart < 1.5) {
        logger.info('Contest in 1h: ' + contest.name);
        for (const subscriber of subscribers) {
          if (subscriber.preferences.includes('email')) {
            await sendEmail(subscriber.email, `Starting in 1 Hour: ${contest.name}`, generate1HourEmail(contest));
          }
          if (subscriber.preferences.includes('sms') && subscriber.phone) {
            await sendSMS(subscriber.phone, `Starting in 1 hour: ${contest.name} on ${contest.platform}. ${contest.url}`);
          }
        }
      }
    }
  } catch (error) {
    logger.error('Reminder check failed', error);
  }
}

// --- Email Templates (generate24HourEmail, generate1HourEmail, generateWelcomeEmail) ---
// (These functions are unchanged, placing them here for completeness)

function generate24HourEmail(contest) {
  // ... (Your existing HTML email template)
  return `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#000;color:#fff;font-family:Arial,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#0a0a0a;">
        <div style="padding:30px;text-align:center;border-bottom:1px solid #333;">
          <h1 style="margin:0;font-size:2rem;">CodeSync</h1>
          <div style="background:#ffaa00;color:#000;padding:6px 15px;display:inline-block;margin-top:10px;font-size:0.75rem;font-weight:700;">CONTEST TOMORROW</div>
        </div>
        <div style="padding:35px 30px;">
          <h2 style="font-size:1.8rem;margin-bottom:25px;">${contest.name}</h2>
          <div style="background:#1a1a1a;border:1px solid #333;padding:15px 20px;margin:10px 0;">
            <div style="color:#888;font-size:0.85rem;">PLATFORM</div>
            <div style="color:#fff;font-weight:600;font-size:1rem;">${contest.platform}</div>
          </div>
          <div style="background:#1a1a1a;border:1px solid #333;padding:15px 20px;margin:10px 0;">
            <div style="color:#888;font-size:0.85rem;">START TIME</div>
            <div style="color:#fff;font-weight:600;font-size:1rem;">${new Date(contest.startTime).toLocaleString()}</div>
          </div>
          <div style="text-align:center;margin:25px 0;">
            <a href="${contest.url}" style="background:#fff;color:#000;padding:18px 50px;text-decoration:none;font-weight:700;display:inline-block;">View Contest</a>
          </div>
        </div>
        <div style="background:#000;padding:25px;text-align:center;border-top:1px solid #333;color:#666;font-size:0.8rem;">
          <p>CodeSync - Made by Arnav</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generate1HourEmail(contest) {
  // ... (Your existing HTML email template)
  return `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#000;color:#fff;font-family:Arial,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#0a0a0a;">
        <div style="padding:30px;text-align:center;border-bottom:2px solid #f00;">
          <h1 style="margin:0;font-size:2rem;">CodeSync</h1>
          <div style="background:#f00;color:#fff;padding:8px 20px;display:inline-block;margin-top:10px;font-size:0.8rem;font-weight:700;">⚡ STARTING IN 1 HOUR</div>
        </div>
        <div style="padding:35px 30px;">
          <div style="color:#f00;font-size:1.1rem;font-weight:700;margin-bottom:20px;">🚨 STARTING SOON!</div>
          <h2 style="font-size:1.8rem;margin-bottom:25px;">${contest.name}</h2>
          <div style="background:#1a1a1a;border:2px solid #f00;padding:20px;text-align:center;margin:25px 0;">
            <div style="color:#f00;font-size:2rem;font-weight:700;">1 HOUR</div>
            <div style="color:#888;font-size:0.9rem;">Until Contest Starts</div>
          </div>
          <div style="text-align:center;margin:25px 0;">
            <a href="${contest.url}" style="background:#f00;color:#fff;padding:18px 50px;text-decoration:none;font-weight:700;display:inline-block;">Join Contest Now</a>
          </div>
        </div>
        <div style="background:#000;padding:25px;text-align:center;border-top:1px solid #333;color:#666;font-size:0.8rem;">
          <p>CodeSync - Made by Arnav</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateWelcomeEmail() {
  // ... (Your existing HTML email template)
  return `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#000;color:#fff;font-family:Arial,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#0a0a0a;">
        <div style="padding:40px 30px;text-align:center;border-bottom:1px solid #333;">
          <h1 style="margin:0;font-size:2.5rem;">CodeSync</h1>
          <p style="color:#888;font-size:0.9rem;margin-top:10px;">Your Competitive Programming Companion</p>
        </div>
        <div style="padding:40px 30px;">
          <h2>Welcome Aboard! 🚀</h2>
          <p style="color:#aaa;line-height:1.8;margin:20px 0;">You're now subscribed to CodeSync! You'll receive timely reminders for coding contests from top platforms.</p>
          <div style="background:#1a1a1a;border:1px solid #333;padding:20px;margin:15px 0;">
            <div style="font-weight:600;margin-bottom:8px;">⏰ Smart Reminders</div>
            <div style="color:#888;font-size:0.9rem;">Get notified 24 hours and 1 hour before contests start</div>
          </div>
          <div style="background:#1a1a1a;border:1px solid #333;padding:20px;margin:15px 0;">
            <div style="font-weight:600;margin-bottom:8px;">🌐 Multi-Platform Coverage</div>
            <div style="color:#888;font-size:0.9rem;">Track contests from Codeforces, CodeChef, LeetCode, and more</div>
          </div>
        </div>
        <div style="background:#000;padding:30px;text-align:center;border-top:1px solid #333;color:#666;font-size:0.85rem;">
          <p>CodeSync - Made by Arnav</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// --- API Routes ---

app.get('/api/contests', async (req, res) => {
  try {
    const db = getDb();
    // Read from the DB cache, which is updated by the cron job
    const contests = await db.collection('contests').find().sort({ startTime: 1 }).toArray();
    res.json({ success: true, contests });
  } catch (error) {
    logger.error('Error in /api/contests:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/subscribe', async (req, res) => {
  logger.separator();
  logger.info('NEW SUBSCRIPTION');
  
  try {
    const { email, phone, preferences } = req.body;
    
    logger.info('Email: ' + email);
    logger.info('Phone: ' + (phone || 'not provided'));
    logger.info('Preferences: ' + JSON.stringify(preferences));
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const db = getDb();
    const subscribersCol = db.collection('subscribers');
    
    const subscriber = {
      email,
      phone: phone || null,
      preferences: preferences || ['email'],
      subscribedAt: new Date().toISOString()
    };
    
    // Use upsert to either insert a new subscriber or update an existing one
    const result = await subscribersCol.updateOne(
        { email: email }, // Filter
        { $set: subscriber }, // Data to set
        { upsert: true } // Options
    );

    if (result.upsertedCount > 0) {
        logger.success('New subscriber saved: ' + email);
    } else {
        logger.success('Subscriber updated: ' + email);
    }
    
    // Send welcome email
    if (transporter && preferences && preferences.includes('email')) {
      await sendEmail(email, 'Welcome to CodeSync!', generateWelcomeEmail());
    }
    
    // Send welcome SMS
    if (phone && preferences && preferences.includes('sms')) {
      logger.info('SMS conditions met - sending welcome SMS');
      await sendSMS(phone, `Welcome to CodeSync! You're subscribed to contest reminders. You'll get notifications 24h and 1h before contests start. - CodeSync`);
    } else {
      logger.warn('SMS not sent - Phone: ' + (phone || 'missing') + ', SMS in prefs: ' + (preferences && preferences.includes('sms')));
    }
    
    logger.separator();
    res.json({ success: true, message: 'Subscribed successfully!' });
  } catch (error) {
    logger.error('Subscription error: ' + error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    const db = getDb();
    const result = await db.collection('subscribers').deleteOne({ email: email });
    
    if (result.deletedCount === 0) {
        logger.warn('Unsubscribe attempt for non-existent email: ' + email);
        return res.status(404).json({ success: false, error: 'Email not found' });
    }

    logger.success('Unsubscribed: ' + email);
    res.json({ success: true, message: 'Unsubscribed successfully' });
  } catch (error) {
    logger.error('Unsubscribe error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/subscribers', async (req, res) => {
  try {
    const db = getDb();
    const subscribers = await db.collection('subscribers').find().toArray();
    res.json({ success: true, subscribers: subscribers.map(s => s.email) });
  } catch (error) {
    logger.error('Error getting subscribers:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint for Render Cron Job ---
// This is the endpoint you will tell Render to call on its schedule.
app.get('/api/check-reminders', async (req, res) => {
    // Secure this endpoint
    if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        logger.error('Unauthorized cron job attempt');
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        logger.info('Cron job triggered via API');
        await checkAndSendReminders(); // Run your existing function
        res.status(200).json({ success: true, message: 'Reminders checked' });
    } catch (error) {
        logger.error('API cron job failed', error);
        res.status(500).json({ success: false, error: 'Job failed' });
    }
});


// Schedule cron job every hour (for local development)
// On Render, you will disable this and use their Cron Job feature to call '/api/check-reminders'
cron.schedule('0 * * * *', () => {
  logger.info('Local node-cron job triggered');
  checkAndSendReminders();
});

// Initialize
// We must connect to the DB *before* starting the server
logger.info('Connecting to database...');
connectDB().then(() => {
    // Start the server
    app.listen(PORT, () => {
        logger.server(`Server running on port ${PORT}`);
    });
    
    // Run an initial check on startup
    logger.info('Running initial contest fetch on startup...');
    checkAndSendReminders();
});