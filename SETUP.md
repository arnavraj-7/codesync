# 🚀 Quick Setup Guide

## Step 1: Setup Gmail for Email Notifications

1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification if not already enabled
3. Go to "App passwords" section
4. Generate a new app password for "Mail"
5. Copy the 16-character password

## Step 2: Setup Twilio for SMS (Optional)

1. Sign up at https://www.twilio.com/
2. Get a free trial phone number
3. Find your Account SID and Auth Token in the console
4. Note: Free trial can only send to verified numbers

## Step 3: Configure Environment Variables

Edit the `.env` file with your credentials:

```env
EMAIL_USER=your.email@gmail.com
EMAIL_PASS=abcd efgh ijkl mnop  # Your 16-char app password
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890
PORT=3001
```

## Step 4: Install and Run

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or for development with auto-reload
npm run dev
```

## Step 5: Open in Browser

Go to: http://localhost:3001

## Testing

To test without email/SMS configured, the app will:
- Still fetch and display contests
- Log what emails/SMS would be sent to console
- Store subscriber data in data.json

## Common Issues

### Gmail says "Less secure apps"
Use App Password instead! Never use your actual Gmail password.

### Twilio SMS not working
- Free trial only sends to verified numbers
- Add recipient phone in Twilio console first
- Ensure phone format is: +[country code][number]

### Port already in use
Change PORT in .env file to something else like 3002

## Production Deployment

### Option 1: Heroku
```bash
heroku create
heroku config:set EMAIL_USER=your@email.com
heroku config:set EMAIL_PASS=yourpassword
git push heroku main
```

### Option 2: VPS (DigitalOcean, AWS, etc.)
```bash
# Install PM2 for process management
npm install -g pm2
pm2 start server.js --name contest-reminder
pm2 save
pm2 startup
```

### Option 3: Docker
```bash
docker build -t contest-reminder .
docker run -p 3001:3001 --env-file .env contest-reminder
```

## Customization Ideas

1. **Add more platforms**: Edit `fetchContests()` in server.js
2. **Change reminder times**: Modify `checkAndSendReminders()`
3. **Custom email templates**: Update HTML in email sending code
4. **Add user dashboard**: Create a page to manage subscriptions
5. **Add authentication**: Secure admin endpoints
6. **Database**: Replace JSON storage with MongoDB/PostgreSQL

## Support

For issues or questions:
1. Check the README.md for detailed documentation
2. Review server console logs
3. Test APIs individually: `curl http://localhost:3001/api/contests`

Happy coding! 🚀
