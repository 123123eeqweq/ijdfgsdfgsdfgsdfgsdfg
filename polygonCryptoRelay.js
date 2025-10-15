const WebSocket = require('ws');
const dotenv = require('dotenv');

dotenv.config();

const POLYGON_KEY = process.env.POLYGON_API_KEY || 'OCt3_VBXxYIKWKSRWNaJk_yquKzcW5UC';
const POLYGON_WS_URL = 'wss://socket.polygon.io/crypto';
const WS_PORT = 8081; // Отдельный порт для крипты

// Подключение к Polygon (единственное!)
let polygonWs = null;
let isPolygonConnected = false;

// Создаём наш WebSocket сервер (ретранслятор)
const wss = new WebSocket.Server({ port: WS_PORT });

// Подключенные клиенты
const clients = new Set();

console.log(`🔷 Polygon CRYPTO Relay запущен на порту ${WS_PORT}`);
console.log(`📡 Подключение к Polygon Crypto...`);

// Функция подключения к Polygon (единственное место!)
function connectToPolygon() {
  polygonWs = new WebSocket(POLYGON_WS_URL);

  polygonWs.on('open', () => {
    console.log('✅ Polygon CRYPTO WebSocket подключен');
    isPolygonConnected = true;

    // Аутентификация
    polygonWs.send(JSON.stringify({
      action: 'auth',
      params: POLYGON_KEY
    }));
  });

  polygonWs.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      const messages = Array.isArray(parsed) ? parsed : [parsed];

      messages.forEach((msg) => {
        // Успешная аутентификация
        if (msg.ev === 'status' && msg.status === 'auth_success') {
          console.log('🔐 Polygon CRYPTO аутентифицирован');
          
          // Подписываемся на 10 Crypto пар
          polygonWs.send(JSON.stringify({
            action: 'subscribe',
            params: 'XAS.BTC-USD,XAS.ETH-USD,XAS.LTC-USD,XAS.XRP-USD,XAS.SOL-USD,XAS.ADA-USD,XAS.DOT-USD,XAS.MATIC-USD,XAS.AVAX-USD,XAS.LINK-USD'
          }));
          
          console.log('📡 Подписка на 10 Crypto пар активирована: BTC-USD, ETH-USD, LTC-USD, XRP-USD, SOL-USD, ADA-USD, DOT-USD, MATIC-USD, AVAX-USD, LINK-USD\n');
        }

        // Ретранслируем ВСЕ сообщения от Polygon всем клиентам
        broadcastToClients(msg);
      });
    } catch (err) {
      console.error('Ошибка парсинга:', err.message);
    }
  });

  polygonWs.on('error', (err) => {
    console.error('Polygon ошибка:', err.message);
  });

  polygonWs.on('close', (code) => {
    console.log(`🔴 Polygon закрыт (${code}). Переподключение...`);
    isPolygonConnected = false;
    setTimeout(connectToPolygon, 3000);
  });
}

// Запускаем подключение к Polygon
connectToPolygon();

// Когда клиент подключается к нашему серверу
wss.on('connection', (ws) => {
  console.log(`✅ Клиент подключился. Всего клиентов: ${clients.size + 1}`);
  clients.add(ws);

  // Отправляем статус подключения к Polygon
  ws.send(JSON.stringify({
    ev: 'status',
    status: isPolygonConnected ? 'relay_ready' : 'relay_connecting',
    message: isPolygonConnected ? 'Crypto Relay готов' : 'Подключение к Polygon Crypto...'
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`🔴 Клиент отключился. Осталось клиентов: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('Ошибка клиента:', err.message);
  });
});

// Функция для отправки сообщения всем клиентам
function broadcastToClients(message) {
  const data = JSON.stringify(message);
  let sentCount = 0;
  
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
      sentCount++;
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Остановка Polygon CRYPTO Relay...');
  console.log(`📊 Подключено клиентов: ${clients.size}`);
  
  // Закрываем всех клиентов
  clients.forEach(client => client.close());
  
  // Закрываем WebSocket сервер
  wss.close();
  
  // Отключаемся от Polygon
  if (polygonWs) {
    polygonWs.close();
  }
  
  process.exit(0);
});

console.log('✅ Готов к ретрансляции CRYPTO');
console.log(`🌐 Клиенты: ws://localhost:${WS_PORT}\n`);

