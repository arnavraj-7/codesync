# 🏆 Contest Reminder

A web application that sends email and SMS reminders for upcoming coding contests from Codeforces, CodeChef, LeetCode, AtCoder, and other platforms.

## 🌟 Features

- **Multi-Platform Support**: Track contests from Codeforces, CodeChef, LeetCode, and more
- **Email Notifications**: Get reminders via email 24 hours and 1 hour before contests
- **SMS Notifications**: Optional SMS reminders using Twilio
- **Add Friends**: Subscribe multiple email addresses at once
- **Real-time Contest List**: View all upcoming contests with countdown timers
- **Automatic Updates**: Contests are fetched and checked hourly

## 📋 Prerequisites

- Node.js (v14 or higher)
- Gmail account (for sending emails)
- Twilio account (optional, for SMS)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd contest-reminder
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Then edit `.env` with your credentials:

```env
# Email Configuration
EMAIL_USER=your.email@gmail.com
EMAIL_PASS=your_app_password

# Twilio Configuration (Optional)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Server Configuration
PORT=3001
```

### 3. Set Up Gmail App Password

To send emails, you need a Gmail App Password:

1. Go to your Google Account settings
2. Navigate to Security → 2-Step Verification
3. Scroll down to "App passwords"
4. Generate a new app password for "Mail"
5. Use this password in the `EMAIL_PASS` field

**Important**: Don't use your regular Gmail password!

### 4. Set Up Twilio (Optional - for SMS)

If you want SMS notifications:

1. Sign up at [Twilio](https://www.twilio.com/)
2. Get a phone number
3. Copy your Account SID and Auth Token
4. Add them to your `.env` file

### 5. Start the Server

```bash
node server.js
```

The server will start on `http://localhost:3001`

## 📱 Usage

### For Users

1. Open `http://localhost:3001` in your browser
2. Enter your email address
3. Optionally add your phone number for SMS
4. Choose notification preferences (Email/SMS)
5. Add friends' emails if you want to subscribe them too
6. Click "Subscribe Now"

You'll receive:
- Confirmation email upon subscription
- Reminders 24 hours before contests
- Reminders 1 hour before contests

### For Developers

#### API Endpoints

**Get Contests**
```bash
GET /api/contests
```

**Subscribe**
```bash
POST /api/subscribe
Content-Type: application/json

{
  "email": "user@example.com",
  "phone": "+1234567890",
  "preferences": ["email", "sms"]
}
```

**Unsubscribe**
```bash
POST /api/unsubscribe
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Get All Subscribers**
```bash
GET /api/subscribers
```

## 🔧 Configuration

### Reminder Schedule

The cron job runs every hour to check for contests and send reminders. You can modify this in `server.js`:

```javascript
// Run every hour
cron.schedule('0 * * * *', () => {
  checkAndSendReminders();
});
```

### Supported Platforms

Currently fetching from:
- ✅ Codeforces
- ✅ CodeChef  
- ✅ LeetCode
- ⏳ AtCoder (requires HTML parsing)

### Adding More Platforms

To add more contest platforms, edit the `fetchContests()` function in `server.js`:

```javascript
async function fetchContests() {
  const contests = [];
  
  // Add your platform API call here
  try {
    const response = await axios.get('YOUR_API_URL');
    // Parse and add contests
  } catch (error) {
    console.error('Error fetching contests:', error);
  }
  
  return contests;
}
```

## 📁 Project Structure

```
contest-reminder/
├── server.js           # Backend server with APIs and cron jobs
├── public/
│   └── index.html     # Frontend UI
├── data.json          # Subscriber and contest data (auto-generated)
├── .env               # Environment variables (create this)
├── .env.example       # Example environment variables
├── package.json       # Dependencies
└── README.md          # This file
```

## 🎨 Customization

### Email Templates

Edit the email HTML in the `sendEmail()` calls in `server.js`:

```javascript
const emailHtml = `
  <h2>Contest Reminder: ${contest.name}</h2>
  <p><strong>Platform:</strong> ${contest.platform}</p>
  <!-- Customize your email template here -->
`;
```

### UI Styling

Modify the CSS in `public/index.html` to change the look and feel.

### Reminder Timing

Change reminder times in the `checkAndSendReminders()` function:

```javascript
// 24 hours before
if (hoursUntilStart > 23 && hoursUntilStart < 25) {
  // Send reminder
}

// 1 hour before  
if (hoursUntilStart > 0.5 && hoursUntilStart < 1.5) {
  // Send reminder
}
```

## 🔒 Security Notes

1. **Never commit `.env` file** - It contains sensitive credentials
2. **Use App Passwords** - Don't use your main Gmail password
3. **Secure your Twilio credentials** - Keep them private
4. **Add authentication** - Consider adding admin authentication for production

## 🐛 Troubleshooting

### Emails not sending

- Check if you're using Gmail App Password (not regular password)
- Verify `EMAIL_USER` and `EMAIL_PASS` in `.env`
- Check server logs for error messages
- Ensure "Less secure app access" is NOT enabled (use App Password instead)

### SMS not sending

- Verify Twilio credentials
- Check if phone number format is correct: `+[country code][number]`
- Ensure Twilio account has credits
- Check Twilio dashboard for error logs

### Contests not loading

- Check if APIs are accessible
- Some platforms may have rate limits
- Check server console for error messages
- Try fetching contests manually: `curl http://localhost:3001/api/contests`

## 📈 Production Deployment

### Using PM2

```bash
npm install -g pm2
pm2 start server.js --name contest-reminder
pm2 save
pm2 startup
```

### Using Docker

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```

### Environment Variables on Server

Set environment variables on your server:
- Heroku: Settings → Config Vars
- AWS: Environment variables in Elastic Beanstalk
- DigitalOcean: Environment variables in App Platform

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

MIT License - feel free to use this for your own projects!

## 🙏 Acknowledgments

- Contest APIs from Codeforces, CodeChef, LeetCode
- Email service via Gmail
- SMS service via Twilio

---

Made with ❤️ for competitive programmers

**Happy Coding! 🚀**
