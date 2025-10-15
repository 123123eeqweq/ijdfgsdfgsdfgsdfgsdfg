const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const ntpClient = require('ntp-client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const polygonCandlesRoutes = require('./routes/polygonCandles');
app.use('/api/polygon-candles', polygonCandlesRoutes);

const polygonCryptoCandlesRoutes = require('./routes/polygonCryptoCandles');
app.use('/api/polygon-crypto-candles', polygonCryptoCandlesRoutes);

const otcCandlesRoutes = require('./routes/otcCandles');
app.use('/api/otc-candles', otcCandlesRoutes);

// ✅ НОВЫЕ БЕЗОПАСНЫЕ роуты для торговли
const tradesRoutes = require('./routes/trades');
app.use('/api/trades', tradesRoutes);

// 🚀 НОВОЕ: Эндпоинт для мониторинга PriceService кэша
const PriceService = require('./services/PriceService');
app.get('/api/price-cache-stats', (req, res) => {
  try {
    const stats = PriceService.getCacheStats();
    res.json({
      success: true,
      ...stats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// 🤖 TradeWorker теперь запускается в tradesRelay.js (npm run trades)
// Здесь не запускаем чтобы избежать дублирования!
console.log('ℹ️ TradeWorker запускается в процессе Trades WS (npm run trades)');

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.DB_NAME || 'vsepoluchitsa_db'
})
.then(() => {
  console.log('✅ Connected to MongoDB Atlas');
  console.log(`📊 Database: ${process.env.DB_NAME || 'vsepoluchitsa_db'}`);
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
  process.exit(1);
});

// Простейший роут для проверки работы сервера
app.get('/', (req, res) => {
  res.json({ 
    message: 'Vsepoluchitsa Backend API is running!',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// Функция для получения NTP времени
const getNTPTime = () => {
  return new Promise((resolve, reject) => {
    ntpClient.getNetworkTime("pool.ntp.org", 123, (err, date) => {
      if (err) {
        reject(err);
      } else {
        resolve(date);
      }
    });
  });
};

// API для получения точного времени
app.get('/api/time', async (req, res) => {
  try {
    // Получаем NTP время
    const ntpTime = await getNTPTime();
    const ntpMoment = moment(ntpTime);
    
    // Локальное время сервера
    const localTime = moment();
    
    // Разница между NTP и локальным временем
    const timeDiff = ntpMoment.diff(localTime, 'milliseconds');
    
    res.json({
      // NTP время (кристально точное)
      ntp: {
        time: ntpMoment.toISOString(),
        timestamp: ntpMoment.valueOf(),
        moscow: ntpMoment.tz('Europe/Moscow').format('DD.MM.YYYY HH:mm:ss'),
        moscowFull: ntpMoment.tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss.SSS'),
        utc: ntpMoment.utc().format(),
        unix: ntpMoment.unix(),
        milliseconds: ntpMoment.valueOf()
      },
      
      // Локальное время сервера
      local: {
        time: localTime.toISOString(),
        timestamp: localTime.valueOf(),
        moscow: localTime.tz('Europe/Moscow').format('DD.MM.YYYY HH:mm:ss'),
        moscowFull: localTime.tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss.SSS')
      },
      
      // Информация о точности
      accuracy: {
        timeDifference: timeDiff,
        timeDifferenceSeconds: Math.round(timeDiff / 1000),
        precision: 'ntp',
        source: 'pool.ntp.org'
      },
      
      timezone: moment.tz.guess(),
      timezoneOffset: ntpMoment.utcOffset()
    });
    
  } catch (error) {
    console.error('NTP Error:', error);
    
    // Fallback на локальное время если NTP не работает
    const localTime = moment();
    res.json({
      ntp: null,
      local: {
        time: localTime.toISOString(),
        timestamp: localTime.valueOf(),
        moscow: localTime.tz('Europe/Moscow').format('DD.MM.YYYY HH:mm:ss'),
        moscowFull: localTime.tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss.SSS')
      },
      accuracy: {
        precision: 'local',
        error: 'NTP недоступен'
      },
      timezone: moment.tz.guess(),
      timezoneOffset: localTime.utcOffset()
    });
  }
});

// Заглушка для API
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  res.json({ 
    status: 'healthy',
    database: dbStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Backend server is running on port ${PORT}`);
  console.log(`📡 API available at: http://localhost:${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
});

// 🛑 Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Получен сигнал SIGINT, завершаем работу...');
  // tradeWorker не определен, так как запускается в отдельном процессе
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Получен сигнал SIGTERM, завершаем работу...');
  // tradeWorker не определен, так как запускается в отдельном процессе
  process.exit(0);
});
