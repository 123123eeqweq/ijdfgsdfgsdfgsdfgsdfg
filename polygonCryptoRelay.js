const WebSocket = require('ws');
const dotenv = require('dotenv');

dotenv.config();

const POLYGON_KEY = process.env.POLYGON_API_KEY || 'OCt3_VBXxYIKWKSRWNaJk_yquKzcW5UC';
const POLYGON_WS_URL = 'wss://socket.polygon.io/crypto';
const WS_PORT = process.env.QUOTES_PORT || 8081; // Отдельный порт для крипты

// Подключение к Polygon (единственное!)
let polygonWs = null;
let isPolygonConnected = false;

// Создаём наш WebSocket сервер (ретранслятор)
const wss = new WebSocket.Server({ port: WS_PORT });

// 🏠 ROOM-BASED АРХИТЕКТУРА
const clients = new Set();
const rooms = new Map(); // Map<pairName, Set<client>>
const clientRooms = new Map(); // Map<client, Set<pairName>>

console.log(`🔷 Polygon CRYPTO Relay запущен на порту ${WS_PORT} (Room-based)`);
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

// 🏠 ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ КОМНАТАМИ
function subscribeClientToPair(client, pair) {
  if (!rooms.has(pair)) {
    rooms.set(pair, new Set());
  }
  rooms.get(pair).add(client);
  
  if (!clientRooms.has(client)) {
    clientRooms.set(client, new Set());
  }
  clientRooms.get(client).add(pair);
  
  console.log(`📌 Клиент подписался на ${pair}. В комнате: ${rooms.get(pair).size} клиентов`);
}

function unsubscribeClientFromPair(client, pair) {
  if (rooms.has(pair)) {
    rooms.get(pair).delete(client);
    if (rooms.get(pair).size === 0) {
      rooms.delete(pair);
    }
  }
  
  if (clientRooms.has(client)) {
    clientRooms.get(client).delete(pair);
  }
  
  console.log(`📍 Клиент отписался от ${pair}`);
}

function unsubscribeClientFromAll(client) {
  const pairs = clientRooms.get(client) || new Set();
  pairs.forEach(pair => {
    if (rooms.has(pair)) {
      rooms.get(pair).delete(client);
      if (rooms.get(pair).size === 0) {
        rooms.delete(pair);
      }
    }
  });
  
  clientRooms.delete(client);
}

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
  
  // 🏠 ОБРАБОТКА СООБЩЕНИЙ ОТ КЛИЕНТА
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.action === 'subscribe' && msg.pair) {
        subscribeClientToPair(ws, msg.pair);
        ws.send(JSON.stringify({ ev: 'status', message: `Subscribed to ${msg.pair}` }));
      } else if (msg.action === 'unsubscribe' && msg.pair) {
        unsubscribeClientFromPair(ws, msg.pair);
        ws.send(JSON.stringify({ ev: 'status', message: `Unsubscribed from ${msg.pair}` }));
      }
    } catch (err) {
      console.error('Ошибка обработки сообщения от клиента:', err.message);
    }
  });

  ws.on('close', () => {
    unsubscribeClientFromAll(ws);
    clients.delete(ws);
    console.log(`🔴 Клиент отключился. Осталось клиентов: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('Ошибка клиента:', err.message);
  });
});

// 🏠 ROOM-BASED: Отправка только подписанным
function broadcastToClients(message) {
  const pair = message.pair; // Crypto использует 'pair' (не 'p')
  
  if (!pair) {
    const data = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
    return;
  }
  
  const subscribedClients = rooms.get(pair);
  
  if (!subscribedClients || subscribedClients.size === 0) {
    return;
  }
  
  const data = JSON.stringify(message);
  subscribedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
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

