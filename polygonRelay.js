const WebSocket = require('ws');
const dotenv = require('dotenv');

dotenv.config();

const POLYGON_KEY = process.env.POLYGON_API_KEY || 'OCt3_VBXxYIKWKSRWNaJk_yquKzcW5UC';
const POLYGON_WS_URL = 'wss://socket.polygon.io/forex';
const WS_PORT = 8080;

// Подключение к Polygon (единственное!)
let polygonWs = null;
let isPolygonConnected = false;

// Создаём наш WebSocket сервер (ретранслятор)
const wss = new WebSocket.Server({ port: WS_PORT });

// Подключенные клиенты
const clients = new Set();

console.log(`🔷 Polygon Relay запущен на порту ${WS_PORT}`);
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

