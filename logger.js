const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logFile = path.join(__dirname, 'app.log');
    this.colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    };
  }

  _getTimestamp() {
    return new Date().toISOString();
  }

  _formatMessage(level, message, data = null) {
    const timestamp = this._getTimestamp();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (data) {
      logMessage += '\n' + JSON.stringify(data, null, 2);
    }
    
    return logMessage;
  }

  _writeToFile(message) {
    try {
      fs.appendFileSync(this.logFile, message + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  _colorize(color, text) {
    return `${this.colors[color]}${text}${this.colors.reset}`;
  }

  info(message, data = null) {
    const formatted = this._formatMessage('INFO', message, data);
    console.log(this._colorize('blue', 'ℹ️  ' + message));
    if (data) console.log(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  success(message, data = null) {
    const formatted = this._formatMessage('SUCCESS', message, data);
    console.log(this._colorize('green', '✅ ' + message));
    if (data) console.log(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  error(message, error = null) {
    const formatted = this._formatMessage('ERROR', message, error);
    console.error(this._colorize('red', '❌ ' + message));
    if (error) {
      console.error(this._colorize('red', error.stack || error));
    }
    this._writeToFile(formatted);
  }

  warn(message, data = null) {
    const formatted = this._formatMessage('WARN', message, data);
    console.warn(this._colorize('yellow', '⚠️  ' + message));
    if (data) console.warn(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  debug(message, data = null) {
    const formatted = this._formatMessage('DEBUG', message, data);
    console.log(this._colorize('magenta', '🔍 ' + message));
    if (data) console.log(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  sms(message, data = null) {
    const formatted = this._formatMessage('SMS', message, data);
    console.log(this._colorize('cyan', '📱 ' + message));
    if (data) console.log(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  email(message, data = null) {
    const formatted = this._formatMessage('EMAIL', message, data);
    console.log(this._colorize('cyan', '📧 ' + message));
    if (data) console.log(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  cron(message, data = null) {
    const formatted = this._formatMessage('CRON', message, data);
    console.log(this._colorize('magenta', '⏰ ' + message));
    if (data) console.log(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  server(message, data = null) {
    const formatted = this._formatMessage('SERVER', message, data);
    console.log(this._colorize('green', '🚀 ' + message));
    if (data) console.log(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  api(method, endpoint, data = null) {
    const message = `${method} ${endpoint}`;
    const formatted = this._formatMessage('API', message, data);
    console.log(this._colorize('blue', '🔌 ' + message));
    if (data) console.log(this._colorize('dim', JSON.stringify(data, null, 2)));
    this._writeToFile(formatted);
  }

  separator() {
    const line = '='.repeat(80);
    console.log(this._colorize('dim', line));
    this._writeToFile(line);
  }

  section(title) {
    this.separator();
    console.log(this._colorize('bright', `\n${title}\n`));
    this._writeToFile(`\n${title}\n`);
    this.separator();
  }
}

module.exports = new Logger();