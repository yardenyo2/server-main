require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const logger = require('./logger');
const rateLimiter = require('./middleware/rateLimiter');
const scraperRoutes = require('./routes/scraper.routes');
const whatsappService = require('./services/whatsapp.service');

// יצירת אפליקציית Express
const app = express();

// יצירת שרת HTTP
const server = require('http').createServer(app);

// הגדרת Socket.IO
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(bodyParser.json());
app.use(helmet());
app.use(compression());
app.use(rateLimiter);

// נתיבים
app.use('/api/scraper', scraperRoutes);
app.use('/api/whatsapp', require('./routes/whatsapp.routes'));

// נתיב בדיקת בריאות
app.use('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// טיפול בשגיאות 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// טיפול בשגיאות כלליות
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// אתחול WhatsApp והפעלת השרת
(async () => {
  try {
    await whatsappService.initialize();
    await startServer();
  } catch (err) {
    logger.error('Failed to initialize:', err);
    process.exit(1);
  }
})();

// הגעלת השרת
const startServer = async (retries = 3) => {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || 'localhost';
  
  try {
    await new Promise((resolve, reject) => {
      server.listen(PORT, HOST)
        .once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            logger.warn(`Port ${PORT} is busy, trying to close existing connection...`);
            require('child_process').exec(`npx kill-port ${PORT}`, async (error) => {
              if (error) {
                logger.error('Failed to kill port:', error);
                if (retries > 0) {
                  logger.info(`Retrying... (${retries} attempts left)`);
                  setTimeout(() => startServer(retries - 1), 1000);
                } else {
                  reject(error);
                }
              } else {
                // נסה שוב אחרי שחרור הפורט
                setTimeout(() => startServer(retries), 1000);
              }
            });
          } else {
            reject(err);
          }
        })
        .once('listening', () => {
          logger.info(`Server running on http://${HOST}:${PORT}`);
          resolve();
        });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};
