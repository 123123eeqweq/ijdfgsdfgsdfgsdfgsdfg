/**
 * 🌐 Quotes Gateway Server
 * 
 * Единый WebSocket gateway для всех источников котировок.
 * Проксирует подключения к соответствующим relay серверам.
 * 
 * ROUTES:
 * - /forex  → ws://localhost:8080 (Polygon Forex Relay)
 * - /crypto → ws://localhost:8081 (Polygon Crypto Relay)
 * - /otc    → ws://localhost:8082 (OTC Relay)
 * 
 * DEPLOYMENT:
 * - Локально: ws://localhost:9000/forex
 * - Render: wss://your-app.onrender.com/forex
 */

const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const dotenv = require('dotenv');

dotenv.config();

// В продакшене (Render) используется PORT, локально - QUOTES_GATEWAY_PORT
// Приоритет: QUOTES_GATEWAY_PORT (локально) → PORT (Render) → 9000 (дефолт)
const PORT = process.env.QUOTES_GATEWAY_PORT || process.env.PORT || 9000;

// 📡 Адреса внутренних relay серверов (для локальной разработки)
const FOREX_RELAY = process.env.FOREX_RELAY_URL || 'ws://localhost:8080';
const CRYPTO_RELAY = process.env.CRYPTO_RELAY_URL || 'ws://localhost:8081';
const OTC_RELAY = process.env.OTC_RELAY_URL || 'ws://localhost:8082';

console.log('🌐 Quotes Gateway Server');
console.log('═══════════════════════════════════════════');

// Создаём HTTP сервер
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'Quotes Gateway',
      routes: {
        forex: '/forex',
        crypto: '/crypto',
        otc: '/otc'
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// Создаём WebSocket серверы (без собственного HTTP сервера)
const wssForex = new WebSocket.Server({ noServer: true });
const wssCrypto = new WebSocket.Server({ noServer: true });
const wssOTC = new WebSocket.Server({ noServer: true });

// Счётчики подключений
let stats = {
  forex: 0,
  crypto: 0,
  otc: 0
};

/**
 * 🔥 Создаёт прокси между клиентом и relay сервером
 */
function createProxyConnection(clientWs, relayUrl, source) {
  console.log(`📡 Новое подключение к ${source.toUpperCase()} relay`);
  stats[source]++;
  
  let relayWs = null;
  let isRelayConnected = false;
  let messageBuffer = []; // Буфер сообщений до подключения к relay
  
  // Подключаемся к relay серверу
  function connectToRelay() {
    relayWs = new WebSocket(relayUrl);
    
    relayWs.on('open', () => {
      console.log(`✅ ${source.toUpperCase()} relay подключен`);
      isRelayConnected = true;
      
      // Отправляем буферизованные сообщения
      while (messageBuffer.length > 0 && relayWs.readyState === WebSocket.OPEN) {
        const msg = messageBuffer.shift();
        relayWs.send(msg);
      }
    });
    
    // Сообщения от relay → клиенту
    relayWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });
    
    relayWs.on('error', (err) => {
      console.error(`❌ ${source.toUpperCase()} relay ошибка:`, err.message);
    });
    
    relayWs.on('close', () => {
      console.log(`🔴 ${source.toUpperCase()} relay отключен, переподключение...`);
      isRelayConnected = false;
      
      // Переподключение через 3 секунды
      setTimeout(() => {
        if (clientWs.readyState === WebSocket.OPEN) {
          connectToRelay();
        }
      }, 3000);
    });
  }
  
  // Запускаем подключение к relay
  connectToRelay();
  
  // Сообщения от клиента → relay
  clientWs.on('message', (data) => {
    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(data);
    } else {
      // Буферизуем если relay ещё не подключен
      messageBuffer.push(data);
    }
  });
  
  // Закрытие соединения клиента
  clientWs.on('close', () => {
    console.log(`🔴 Клиент отключился от ${source.toUpperCase()}`);
    stats[source]--;
    
    if (relayWs) {
      relayWs.close();
    }
  });
  
  clientWs.on('error', (err) => {
    console.error(`❌ Ошибка клиента ${source.toUpperCase()}:`, err.message);
  });
}

// ============================================
// 🔥 РОУТИНГ WebSocket ПОДКЛЮЧЕНИЙ
// ============================================

server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;
  
  console.log(`🔌 WebSocket upgrade запрос: ${pathname}`);
  
  // Роутинг по пути
  if (pathname === '/forex') {
    wssForex.handleUpgrade(request, socket, head, (ws) => {
      wssForex.emit('connection', ws, request);
    });
  } else if (pathname === '/crypto') {
    wssCrypto.handleUpgrade(request, socket, head, (ws) => {
      wssCrypto.emit('connection', ws, request);
    });
  } else if (pathname === '/otc') {
    wssOTC.handleUpgrade(request, socket, head, (ws) => {
      wssOTC.emit('connection', ws, request);
    });
  } else {
    console.log(`❌ Неизвестный путь: ${pathname}`);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// ============================================
// 🔥 ОБРАБОТЧИКИ ПОДКЛЮЧЕНИЙ
// ============================================

wssForex.on('connection', (ws, request) => {
  createProxyConnection(ws, FOREX_RELAY, 'forex');
});

wssCrypto.on('connection', (ws, request) => {
  createProxyConnection(ws, CRYPTO_RELAY, 'crypto');
});

wssOTC.on('connection', (ws, request) => {
  createProxyConnection(ws, OTC_RELAY, 'otc');
});

// ============================================
// 🚀 ЗАПУСК СЕРВЕРА
// ============================================

server.listen(PORT, () => {
  console.log(`✅ Gateway запущен на порту ${PORT}`);
  console.log('');
  console.log('📊 Доступные endpoints:');
  console.log(`   • ws://localhost:${PORT}/forex  → ${FOREX_RELAY}`);
  console.log(`   • ws://localhost:${PORT}/crypto → ${CRYPTO_RELAY}`);
  console.log(`   • ws://localhost:${PORT}/otc    → ${OTC_RELAY}`);
  console.log('');
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('⚠️  Убедитесь что relay серверы запущены (npm run quotes)');
  console.log('═══════════════════════════════════════════\n');
});

// ============================================
// 📊 СТАТИСТИКА (каждые 30 секунд)
// ============================================

setInterval(() => {
  const total = stats.forex + stats.crypto + stats.otc;
  if (total > 0) {
    console.log(`📊 Активных подключений: Forex: ${stats.forex} | Crypto: ${stats.crypto} | OTC: ${stats.otc} | Всего: ${total}`);
  }
}, 30000);

// ============================================
// 🛑 GRACEFUL SHUTDOWN
// ============================================

process.on('SIGINT', () => {
  console.log('\n\n👋 Остановка Quotes Gateway...');
  console.log(`📊 Активных подключений: ${stats.forex + stats.crypto + stats.otc}`);
  
  // Закрываем все WebSocket серверы
  wssForex.close();
  wssCrypto.close();
  wssOTC.close();
  
  // Закрываем HTTP сервер
  server.close(() => {
    console.log('✅ Gateway остановлен');
    process.exit(0);
  });
  
  // Форсированное завершение через 5 секунд
  setTimeout(() => {
    console.log('⚠️  Форсированное завершение...');
    process.exit(1);
  }, 5000);
});

