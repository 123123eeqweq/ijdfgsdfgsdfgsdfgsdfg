const WebSocket = require('ws');
const dotenv = require('dotenv');

dotenv.config();

const POLYGON_KEY = process.env.POLYGON_API_KEY || 'OCt3_VBXxYIKWKSRWNaJk_yquKzcW5UC';
const POLYGON_WS_URL = 'wss://socket.polygon.io/forex';
const WS_PORT = process.env.POLYGON_WS_PORT || 8080;

// Подключение к Polygon (единственное!)
let polygonWs = null;
let isPolygonConnected = false;

// Создаём наш WebSocket сервер (ретранслятор)
const wss = new WebSocket.Server({ port: WS_PORT });

// 🏠 ROOM-BASED АРХИТЕКТУРА
const clients = new Set(); // Все подключенные клиенты
const rooms = new Map(); // Map<pairName, Set<client>> - какие клиенты подписаны на какую пару
const clientRooms = new Map(); // Map<client, Set<pairName>> - на что подписан каждый клиент

console.log(`🔷 Polygon Relay запущен на порту ${WS_PORT} (Room-based)`);
console.log(`📡 Подключение к Polygon Forex...`);

// Функция подключения к Polygon (единственное место!)
function connectToPolygon() {
  polygonWs = new WebSocket(POLYGON_WS_URL);

  polygonWs.on('open', () => {
    console.log('✅ Polygon WebSocket подключен');
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
          console.log('🔐 Polygon аутентифицирован');
          
          // Подписываемся на 20 Forex пар
          polygonWs.send(JSON.stringify({
            action: 'subscribe',
            params: 'CAS.EUR/USD,CAS.AUD/CAD,CAS.USD/JPY,CAS.AUD/JPY,CAS.GBP/USD,CAS.GBP/CAD,CAS.EUR/CAD,CAS.CHF/JPY,CAS.CAD/CHF,CAS.USD/CHF,CAS.USD/CAD,CAS.GBP/AUD,CAS.AUD/CHF,CAS.EUR/CHF,CAS.GBP/CHF,CAS.CAD/JPY,CAS.EUR/JPY,CAS.AUD/JPY,CAS.EUR/GBP,CAS.GBP/JPY'
          }));
          
          console.log('📡 Подписка на 20 Forex пар активирована: EUR/USD, AUD/CAD, USD/JPY, AUD/JPY, GBP/USD, GBP/CAD, EUR/CAD, CHF/JPY, CAD/CHF, USD/CHF, USD/CAD, GBP/AUD, AUD/CHF, EUR/CHF, GBP/CHF, CAD/JPY, EUR/JPY, AUD/JPY, EUR/GBP, GBP/JPY\n');
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
  // Добавляем клиента в комнату пары
  if (!rooms.has(pair)) {
    rooms.set(pair, new Set());
  }
  rooms.get(pair).add(client);
  
  // Отслеживаем подписки клиента
  if (!clientRooms.has(client)) {
    clientRooms.set(client, new Set());
  }
  clientRooms.get(client).add(pair);
  
  console.log(`📌 Клиент подписался на ${pair}. В комнате: ${rooms.get(pair).size} клиентов`);
}

function unsubscribeClientFromPair(client, pair) {
  // Удаляем клиента из комнаты
  if (rooms.has(pair)) {
    rooms.get(pair).delete(client);
    if (rooms.get(pair).size === 0) {
      rooms.delete(pair);
    }
  }
  
  // Удаляем из отслеживания
  if (clientRooms.has(client)) {
    clientRooms.get(client).delete(pair);
  }
  
  console.log(`📍 Клиент отписался от ${pair}`);
}

function unsubscribeClientFromAll(client) {
  // Удаляем клиента из всех комнат
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
    message: isPolygonConnected ? 'Relay готов' : 'Подключение к Polygon...'
  }));
  
  // 🏠 ОБРАБОТКА СООБЩЕНИЙ ОТ КЛИЕНТА (subscribe/unsubscribe)
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

// 🏠 ROOM-BASED: Отправка сообщения только подписанным клиентам
function broadcastToClients(message) {
  // Определяем пару из сообщения
  const pair = message.p; // Polygon присылает пару в поле 'p'
  
  if (!pair) {
    // Если нет пары - отправляем всем (статусные сообщения)
    const data = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
    return;
  }
  
  // 🔥 КОНСИСТЕНТНОСТЬ: Добавляем поле 'pair' для обратной совместимости
  // Polygon присылает 'p', но мы также добавляем 'pair' для единообразия
  if (!message.pair && message.p) {
    message.pair = message.p;
  }
  
  // Получаем клиентов подписанных на эту пару
  const subscribedClients = rooms.get(pair);
  
  if (!subscribedClients || subscribedClients.size === 0) {
    // Никто не подписан на эту пару - не отправляем
    return;
  }
  
  // Отправляем только подписанным
  const data = JSON.stringify(message);
  let sentCount = 0;
  
  subscribedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
      sentCount++;
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Остановка Polygon Relay...');
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

console.log('✅ Готов к ретрансляции');
console.log(`🌐 Клиенты: ws://localhost:${WS_PORT}\n`);

