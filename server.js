// --- server.js ---
// Refactored to use MongoDB instead of data.json
// Reminder logic adjusted for 6-hour cron, with dynamic email times.

const express = require('express');
const cors = require('cors');
const cron = require('node-cron'); // Will be commented out for Render deployment
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
    host: 'smtp.gmail.com',
    port: 465, // Use 465 for implicit SSL
    secure: true, // Use true for port 465
    auth: {
        user: process.env.EMAIL_USER, // Your Gmail email address
        pass: process.env.EMAIL_PASS // The App Password you generated
    }
    // Optional for debugging if you get SSL errors, but NOT for production:
    // tls: { rejectUnauthorized: false }
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

// Helper function to generate a unique reminder ID for a contest and type
function getReminderId(contestUrl, reminderType) {
    return `${contestUrl}-${reminderType}`; 
}

async function checkAndSendReminders() {
  logger.cron('Checking reminders...');
  
  try {
    const db = getDb(); // Get the connected DB instance
    const subscribersCol = db.collection('subscribers');
    const contestsCol = db.collection('contests');
    const sentRemindersCol = db.collection('sentReminders'); // Collection to track sent reminders

    const contests = await fetchContests();
    
    // Clear contests that have already ended more than 1 hour ago
    await contestsCol.deleteMany({ startTime: { $lt: new Date(Date.now() - 3600 * 1000) } }); 
    if (contests.length > 0) {
        // Upsert new contests to avoid duplicates and update existing ones
        await contestsCol.bulkWrite(
            contests.map(c => ({
                updateOne: {
                    filter: { url: c.url, platform: c.platform }, // Unique identifier for a contest
                    update: { $set: c },
                    upsert: true
                }
            }))
        );
    }
    logger.cron(`Fetched and updated ${contests.length} upcoming contests in DB.`);

    const subscribers = await subscribersCol.find().toArray();
    if (subscribers.length === 0) {
        logger.cron('No subscribers found. Skipping reminder check.');
        return;
    }
    logger.cron(`Checking reminders for ${subscribers.length} subscribers...`);

    const now = new Date();
    
    for (const contest of contests) {
      const hoursUntilStart = (new Date(contest.startTime) - now) / (1000 * 3600);
      
        // 24-hour reminder window: Trigger if contest is between ~18 to 27 hours away
        if (hoursUntilStart > 18 && hoursUntilStart <= 27) { 
            const reminderType = '24hr';
            const reminderId = getReminderId(contest.url, reminderType);
            const alreadySent = await sentRemindersCol.findOne({ reminderId: reminderId });

            if (!alreadySent) {
                const roundedHours = Math.round(hoursUntilStart);
                logger.info(`Sending 24hr reminder for: ${contest.name} (Starts in ~${roundedHours}h)`);
                for (const subscriber of subscribers) {
                    if (subscriber.preferences.includes('email')) {
                        await sendEmail(subscriber.email, `Contest Reminder: ${contest.name}`, generate24HourEmail(contest, roundedHours)); // Pass roundedHours
                    }
                    if (subscriber.preferences.includes('sms') && subscriber.phone) {
                        await sendSMS(subscriber.phone, `Contest in ~${roundedHours}h: ${contest.name} on ${contest.platform} at ${new Date(contest.startTime).toLocaleString()}. ${contest.url}`);
                    }
                }
                // Mark reminder as sent
                await sentRemindersCol.insertOne({ reminderId: reminderId, sentAt: now, contest: contest });
            } else {
                logger.debug(`24hr reminder already sent for: ${contest.name}`);
            }
        }
      
        // 1-hour reminder window: Trigger if contest is between ~0.1 to 6 hours away
        if (hoursUntilStart > 0.1 && hoursUntilStart <= 6) { 
            const reminderType = '1hr';
            const reminderId = getReminderId(contest.url, reminderType);
            const alreadySent = await sentRemindersCol.findOne({ reminderId: reminderId });

            if (!alreadySent) {
                const minutesUntilStart = Math.round(hoursUntilStart * 60);
                const displayTime = minutesUntilStart <= 90 ? `${minutesUntilStart} minutes` : `${Math.round(hoursUntilStart)} hours`;

                logger.info(`Sending 1hr reminder for: ${contest.name} (Starts in ~${displayTime})`);
                for (const subscriber of subscribers) {
                    if (subscriber.preferences.includes('email')) {
                        await sendEmail(subscriber.email, `Starting Soon: ${contest.name}`, generate1HourEmail(contest, displayTime)); // Pass displayTime
                    }
                    if (subscriber.preferences.includes('sms') && subscriber.phone) {
                        await sendSMS(subscriber.phone, `Starting in ~${displayTime}: ${contest.name} on ${contest.platform}. ${contest.url}`);
                    }
                }
                // Mark reminder as sent
                await sentRemindersCol.insertOne({ reminderId: reminderId, sentAt: now, contest: contest });
            } else {
                logger.debug(`1hr reminder already sent for: ${contest.name}`);
            }
        }

        // Optional: Clean up old sent reminders for contests that have ended more than 1 hour ago
        if (hoursUntilStart < -1 && contest.url) { 
            await sentRemindersCol.deleteMany({ 'contest.url': contest.url });
        }
    }
  } catch (error) {
    logger.error('Reminder check failed', error);
  }
}

// --- Email Templates (MODIFIED to be dynamic) ---

function generate24HourEmail(contest, hoursUntilStart) {
  const displayHours = hoursUntilStart ? `${hoursUntilStart} HOURS` : 'TOMORROW';
  const headerText = hoursUntilStart ? `STARTING IN ${displayHours}` : 'CONTEST TOMORROW';
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Contest Reminder - CodeSync</title>
        <style>
            body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f4; color: #333; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            table { border-spacing: 0; border-collapse: collapse; }
            td { padding: 0; }
            img { border: 0; }
            .wrapper { width: 100%; table-layout: fixed; background-color: #f4f4f4; padding-bottom: 60px; }
            .main { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .header { background-color: #1a1a1a; padding: 30px; text-align: center; color: #ffffff; }
            .header h1 { margin: 0; font-size: 2.5rem; font-weight: 700; letter-spacing: 2px; }
            .header .tag { background-color: #ffaa00; color: #1a1a1a; padding: 8px 18px; display: inline-block; margin-top: 15px; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; border-radius: 4px; }
            .content { padding: 40px 30px; text-align: center; }
            .content h2 { font-size: 2rem; margin-bottom: 30px; color: #1a1a1a; line-height: 1.3; }
            .info-block { background-color: #f9f9f9; border: 1px solid #e0e0e0; padding: 20px 25px; margin: 15px 0; border-radius: 6px; text-align: left; }
            .info-block .label { color: #888; font-size: 0.85rem; margin-bottom: 5px; text-transform: uppercase; font-weight: 600; }
            .info-block .value { color: #333; font-weight: 700; font-size: 1.1rem; }
            .button-container { text-align: center; margin-top: 40px; }
            .button { background-color: #007bff; color: #ffffff; padding: 18px 50px; text-decoration: none; font-weight: 700; display: inline-block; border-radius: 6px; font-size: 1.05rem; transition: background-color 0.3s ease; }
            .button:hover { background-color: #0056b3; }
            .footer { background-color: #1a1a1a; padding: 30px; text-align: center; color: #cccccc; font-size: 0.8rem; border-top: 1px solid #333; }
            .footer p { margin: 0; }

            @media only screen and (max-width: 620px) {
                .main { width: 100%; border-radius: 0; }
                .content { padding: 30px 20px; }
                .header h1 { font-size: 2rem; }
                .content h2 { font-size: 1.6rem; }
                .button { padding: 15px 40px; font-size: 1rem; }
            }
        </style>
    </head>
    <body>
        <center class="wrapper">
            <div class="main">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td class="header">
                            <h1>CodeSync</h1>
                            <div class="tag">${headerText}</div>
                        </td>
                    </tr>
                    <tr>
                        <td class="content">
                            <h2>${contest.name}</h2>
                            <div class="info-block">
                                <div class="label">PLATFORM</div>
                                <div class="value">${contest.platform}</div>
                            </div>
                            <div class="info-block">
                                <div class="label">START TIME</div>
                                <div class="value">${new Date(contest.startTime).toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })}</div>
                            </div>
                            <div class="button-container">
                                <a href="${contest.url}" class="button">View Contest</a>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td class="footer">
                            <p>CodeSync - Made by Arnav</p>
                        </td>
                    </tr>
                </table>
            </div>
        </center>
    </body>
    </html>
  `;
}

function generate1HourEmail(contest, displayTime) {
  const headerText = displayTime ? `⚡ STARTING IN ${displayTime.toUpperCase()}` : '⚡ STARTING SOON';
  const centralText = displayTime ? displayTime.toUpperCase() : 'SOON';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Contest Starting Soon! - CodeSync</title>
        <style>
            body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f4; color: #333; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            table { border-spacing: 0; border-collapse: collapse; }
            td { padding: 0; }
            img { border: 0; }
            .wrapper { width: 100%; table-layout: fixed; background-color: #f4f4f4; padding-bottom: 60px; }
            .main { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .header { background-color: #e74c3c; padding: 30px; text-align: center; color: #ffffff; }
            .header h1 { margin: 0; font-size: 2.5rem; font-weight: 700; letter-spacing: 2px; }
            .header .tag { background-color: #c0392b; color: #ffffff; padding: 8px 18px; display: inline-block; margin-top: 15px; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; border-radius: 4px; }
            .content { padding: 40px 30px; text-align: center; }
            .content .alert-text { color: #e74c3c; font-size: 1.1rem; font-weight: 700; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
            .content h2 { font-size: 2.2rem; margin-bottom: 30px; color: #1a1a1a; line-height: 1.3; }
            .countdown-box { background-color: #fff0f0; border: 2px solid #e74c3c; padding: 25px; margin: 25px 0; border-radius: 8px; }
            .countdown-box .time { color: #e74c3c; font-size: 2.8rem; font-weight: 900; line-height: 1; margin-bottom: 10px; }
            .countdown-box .label { color: #888; font-size: 0.9rem; text-transform: uppercase; font-weight: 600; }
            .button-container { text-align: center; margin-top: 40px; }
            .button { background-color: #e74c3c; color: #ffffff; padding: 18px 50px; text-decoration: none; font-weight: 700; display: inline-block; border-radius: 6px; font-size: 1.05rem; transition: background-color 0.3s ease; }
            .button:hover { background-color: #c0392b; }
            .footer { background-color: #1a1a1a; padding: 30px; text-align: center; color: #cccccc; font-size: 0.8rem; border-top: 1px solid #333; }
            .footer p { margin: 0; }

            @media only screen and (max-width: 620px) {
                .main { width: 100%; border-radius: 0; }
                .content { padding: 30px 20px; }
                .header h1 { font-size: 2rem; }
                .content h2 { font-size: 1.8rem; }
                .countdown-box .time { font-size: 2.2rem; }
                .button { padding: 15px 40px; font-size: 1rem; }
            }
        </style>
    </head>
    <body>
        <center class="wrapper">
            <div class="main">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td class="header">
                            <h1>CodeSync</h1>
                            <div class="tag">${headerText}</div>
                        </td>
                    </tr>
                    <tr>
                        <td class="content">
                            <div class="alert-text">🚨 Contest Alert!</div>
                            <h2>${contest.name}</h2>
                            <div class="countdown-box">
                                <div class="time">${centralText}</div>
                                <div class="label">UNTIL CONTEST STARTS</div>
                            </div>
                            <div class="button-container">
                                <a href="${contest.url}" class="button">Join Contest Now</a>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td class="footer">
                            <p>CodeSync - Made by Arnav</p>
                        </td>
                    </tr>
                </table>
            </div>
        </center>
    </body>
    </html>
  `;
}

function generateWelcomeEmail() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to CodeSync! - Your Competitive Programming Companion</title>
        <style>
            body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f4; color: #333; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            table { border-spacing: 0; border-collapse: collapse; }
            td { padding: 0; }
            img { border: 0; }
            .wrapper { width: 100%; table-layout: fixed; background-color: #f4f4f4; padding-bottom: 60px; }
            .main { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .header { background-color: #007bff; padding: 40px 30px; text-align: center; color: #ffffff; }
            .header h1 { margin: 0; font-size: 3rem; font-weight: 800; letter-spacing: 3px; }
            .header p { margin-top: 10px; font-size: 1rem; color: #e0e0e0; }
            .content { padding: 40px 30px; }
            .content h2 { font-size: 2.2rem; margin-bottom: 25px; color: #1a1a1a; text-align: center; }
            .content p { color: #555; line-height: 1.7; margin-bottom: 25px; text-align: center; font-size: 1rem; }
            .feature-block { background-color: #f9f9f9; border: 1px solid #e0e0e0; padding: 25px; margin: 15px 0; border-radius: 8px; text-align: left; }
            .feature-block .title { font-weight: 700; margin-bottom: 10px; font-size: 1.15rem; color: #1a1a1a; }
            .feature-block .description { color: #777; font-size: 0.95rem; line-height: 1.5; }
            .footer { background-color: #1a1a1a; padding: 30px; text-align: center; color: #cccccc; font-size: 0.8rem; border-top: 1px solid #333; }
            .footer p { margin: 0; }

            @media only screen and (max-width: 620px) {
                .main { width: 100%; border-radius: 0; }
                .content { padding: 30px 20px; }
                .header h1 { font-size: 2.5rem; }
                .content h2 { font-size: 1.8rem; }
            }
        </style>
    </head>
    <body>
        <center class="wrapper">
            <div class="main">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td class="header">
                            <h1>CodeSync</h1>
                            <p>Your Competitive Programming Companion</p>
                        </td>
                    </tr>
                    <tr>
                        <td class="content">
                            <h2>Welcome Aboard! 🚀</h2>
                            <p>You're now subscribed to CodeSync! Get ready to supercharge your competitive programming journey with timely reminders for coding contests from top platforms.</p>
                            
                            <div class="feature-block">
                                <div class="title">⏰ Smart Reminders</div>
                                <div class="description">Get notified 24 hours and 1 hour before contests begin, so you never miss a challenge.</div>
                            </div>
                            
                            <div class="feature-block">
                                <div class="title">🌐 Multi-Platform Coverage</div>
                                <div class="description">We track contests from Codeforces, CodeChef, LeetCode, and more, all in one place.</div>
                            </div>

                            <div class="feature-block">
                                <div class="title">🚀 Stay Ahead</div>
                                <div class="description">Focus on coding, we'll handle the reminders. Improve your skills and climb leaderboards.</div>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td class="footer">
                            <p>CodeSync - Made by Arnav</p>
                        </td>
                    </tr>
                </table>
            </div>
        </center>
    </body>
    </html>
  `;
}
function generateAlreadySubscribedEmail() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>You're Already Subscribed! - CodeSync</title>
            <style>
                body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f4; color: #333; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
                table { border-spacing: 0; border-collapse: collapse; }
                td { padding: 0; }
                img { border: 0; }
                .wrapper { width: 100%; table-layout: fixed; background-color: #f4f4f4; padding-bottom: 60px; }
                .main { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                .header { background-color: #f39c12; padding: 40px 30px; text-align: center; color: #ffffff; }
                .header h1 { margin: 0; font-size: 3rem; font-weight: 800; letter-spacing: 3px; }
                .header p { margin-top: 10px; font-size: 1rem; color: #e0e0e0; }
                .content { padding: 40px 30px; text-align: center; }
                .content h2 { font-size: 2.2rem; margin-bottom: 25px; color: #1a1a1a; }
                .content p { color: #555; line-height: 1.7; margin-bottom: 25px; font-size: 1rem; }
                .cta-button { background-color: #f39c12; color: #ffffff; padding: 15px 30px; text-decoration: none; font-weight: 700; display: inline-block; border-radius: 6px; font-size: 1rem; transition: background-color 0.3s ease; margin-top: 20px;}
                .cta-button:hover { background-color: #e67e22; }
                .footer { background-color: #1a1a1a; padding: 30px; text-align: center; color: #cccccc; font-size: 0.8rem; border-top: 1px solid #333; }
                .footer p { margin: 0; }

                @media only screen and (max-width: 620px) {
                    .main { width: 100%; border-radius: 0; }
                    .content { padding: 30px 20px; }
                    .header h1 { font-size: 2.5rem; }
                    .content h2 { font-size: 1.8rem; }
                }
            </style>
        </head>
        <body>
            <center class="wrapper">
                <div class="main">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td class="header">
                                <h1>CodeSync</h1>
                                <p>Competitive Programming Companion</p>
                            </td>
                        </tr>
                        <tr>
                            <td class="content">
                                <h2>You're Already Subscribed! 👋</h2>
                                <p>It looks like you're already a valued member of the CodeSync community. We've got your back with contest reminders!</p>
                                <p>If you meant to update your preferences, don't worry, we've updated them based on your recent submission.</p>
                            </td>
                        </tr>
                        <tr>
                            <td class="footer">
                                <p>CodeSync - Made by Arnav</p>
                            </td>
                        </tr>
                    </table>
                </div>
            </center>
        </body>
        </html>
    `;
}

// --- API Routes ---

app.get('/api/contests', async (req, res) => {
  try {
    const db = getDb();
    const contests = await db.collection('contests').find().sort({ startTime: 1 }).toArray();
    res.json({ success: true, contests });
  } catch (error) {
    logger.error('Error in /api/contests:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/subscribe', async (req, res) => {
    logger.separator();
    logger.info('NEW SUBSCRIPTION / UPDATE REQUEST');

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

        // Check if subscriber already exists
        const existingSubscriber = await subscribersCol.findOne({ email: email });

        let message = '';
        if (existingSubscriber) {
            // Subscriber exists, update their preferences if they provided new ones
            const updateDoc = {
                $set: {
                    phone: phone || existingSubscriber.phone || null, // Update phone if provided, otherwise keep existing
                    preferences: preferences || existingSubscriber.preferences || ['email'], // Update preferences or keep existing
                    updatedAt: new Date().toISOString() // Add an update timestamp
                }
            };
            await subscribersCol.updateOne({ email: email }, updateDoc);
            message = 'You are already subscribed. Your preferences have been updated.';
            logger.success('Existing subscriber updated: ' + email);

            // Send "already subscribed" email
            if (transporter && preferences && preferences.includes('email')) {
                await sendEmail(email, 'CodeSync: You are already subscribed!', generateAlreadySubscribedEmail());
            }

        } else {
            // New subscriber
            const newSubscriber = {
                email,
                phone: phone || null,
                preferences: preferences || ['email'],
                subscribedAt: new Date().toISOString()
            };
            await subscribersCol.insertOne(newSubscriber);
            message = 'Subscribed successfully!';
            logger.success('New subscriber saved: ' + email);

            // Send welcome email
            if (transporter && preferences && preferences.includes('email')) {
                await sendEmail(email, 'Welcome to CodeSync!', generateWelcomeEmail());
            }
        }

        // Send welcome SMS (only for new subscriptions or if phone/sms preference was just added)
        // More sophisticated logic might be needed if you want to prevent welcome SMS on every update
        if (phone && preferences && preferences.includes('sms') && (!existingSubscriber || (existingSubscriber && !existingSubscriber.preferences.includes('sms')))) {
            logger.info('SMS conditions met - sending welcome SMS');
            await sendSMS(phone, `Welcome to CodeSync! You're subscribed to contest reminders. You'll get notifications 24h and 1h before contests start. - CodeSync`);
        } else if (phone && preferences && preferences.includes('sms') && existingSubscriber && existingSubscriber.preferences.includes('sms')) {
             logger.info('SMS for existing subscriber not resent to avoid spam.');
        } else {
            logger.warn('SMS not sent - Phone: ' + (phone || 'missing') + ', SMS in prefs: ' + (preferences && preferences.includes('sms')));
        }

        logger.separator();
        res.json({ success: true, message: message });
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


// --- Server Start ---
logger.info('Connecting to database...');
connectDB().then(() => {
    app.listen(PORT, () => {
        logger.server(`Server running on port ${PORT}`);
    });
    
    logger.info('Running initial contest fetch on startup...');
    checkAndSendReminders(); // This will run immediately after server starts, then the cron will take over
}).catch(error => {
    logger.error('Failed to start application due to DB connection or initial setup:', error.message);
    process.exit(1); // Exit the process with an error code
});


// --- CRON Job (for scheduling checkAndSendReminders) ---
// This cron job will run every 6 hours
// It's commented out because Render's cron jobs will hit the /api/check-reminders endpoint.
// If you were self-hosting, you would uncomment this.

// cron.schedule('0 */6 * * *', async () => { // Runs every 6 hours
//     logger.cron('CRON job: Automatically checking and sending reminders...');
//     await checkAndSendReminders();
// }, {
//     scheduled: true,
//     timezone: "Asia/Kolkata" // Or your desired timezone
// });
// logger.cron('Scheduled cron job to run every 6 hours.');

