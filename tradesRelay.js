/**
 * 🔒 TRADES WebSocket Relay - Event-Driven система для трейдов
 * 
 * BEST PRACTICES:
 * 1. Отдельный WS для User Data (не мешается с Market Data)
 * 2. JWT авторизация для каждого клиента
 * 3. Room-based routing (каждый юзер в своей комнате)
 * 4. Heartbeat для проверки соединения
 * 5. Graceful shutdown
 * 
 * СОБЫТИЯ:
 * - tradeCreated: Когда создана новая сделка
 * - tradeUpdated: Когда сделка закрыта (won/lost)
 * - balanceUpdated: Когда баланс изменился
 */

// ✅ Загружаем переменные окружения!
require('dotenv').config();

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const EventEmitter = require('events');

// 🔥 Event Emitter для in-process communication
const internalEmitter = new EventEmitter();

const PORT = process.env.TRADES_PORT || process.env.TRADES_WS_PORT || 8083;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Хранилище активных соединений по userId
const clients = new Map(); // userId -> Set<WebSocket>

// ============================================
// 🔥 СОЗДАНИЕ СЕРВЕРА (только если запущен напрямую!)
// ============================================
let wss = null;

// ✅ Запускаем сервер ТОЛЬКО если файл запущен напрямую (не через require)
if (require.main === module) {
  // Создаем WebSocket сервер
  wss = new WebSocket.Server({ 
    port: PORT,
    clientTracking: true 
  });

  console.log(`🔒 Trades WebSocket Relay запущен на ws://localhost:${PORT}`);
  
  // 🔥 Запускаем TradeWorker в том же процессе!
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DB_NAME || 'vsepoluchitsa_db'
  })
  .then(() => {
    console.log('✅ MongoDB подключена для TradeWorker');
    
    // Запускаем worker
    const TradeWorker = require('./workers/TradeWorker');
    TradeWorker.start();
    console.log('🤖 TradeWorker запущен в Trades процессе');
  })
  .catch((error) => {
    console.error('❌ MongoDB ошибка:', error);
    process.exit(1);
  });
  
} else {
  // Файл импортирован через require - НЕ запускаем сервер
  console.log('ℹ️ tradesRelay импортирован как модуль (сервер не запущен)');
}

// ============================================
// 🔥 ОБРАБОТКА ПОДКЛЮЧЕНИЙ
// ============================================

// ============================================
// 🔥 IN-PROCESS EVENT LISTENER (для TradeWorker)
// ============================================

internalEmitter.on('sendToUser', ({ userId, event, data }) => {
  sendToUser(userId, event, data);
});

// ============================================
// 🔥 ОБРАБОТКА ВНЕШНИХ ПОДКЛЮЧЕНИЙ
// ============================================

if (wss) {
  wss.on('connection', (ws, req) => {
  let userId = null;
  let isAuthenticated = false;
  let heartbeatInterval = null;

  console.log('📡 Новое подключение к Trades WS');

  // ============================================
  // 🔥 HEARTBEAT (проверка живого соединения)
  // ============================================
  
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  heartbeatInterval = setInterval(() => {
    if (ws.isAlive === false) {
      console.log(`💀 Клиент ${userId || 'неавторизован'} не отвечает, закрываем`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  }, 30000); // Каждые 30 секунд

  // ============================================
  // 🔥 ОБРАБОТКА СООБЩЕНИЙ
  // ============================================
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      // ============================================
      // 🔥 АВТОРИЗАЦИЯ (первое сообщение)
      // ============================================
      
      if (message.action === 'auth') {
        try {
          const token = message.token;
          if (!token) {
            ws.send(JSON.stringify({
              event: 'error',
              message: 'Токен не предоставлен'
            }));
            ws.close(1008, 'Unauthorized');
            return;
          }

          // Проверяем JWT
          const decoded = jwt.verify(token, JWT_SECRET);
          userId = decoded.userId;
          isAuthenticated = true;

          // Добавляем клиента в комнату userId
          if (!clients.has(userId)) {
            clients.set(userId, new Set());
          }
          clients.get(userId).add(ws);

          console.log(`✅ Клиент авторизован: ${userId} (email: ${decoded.email || 'N/A'})`);
          console.log(`   Активных подключений для ${userId}: ${clients.get(userId).size}`);

          // Подтверждаем авторизацию
          ws.send(JSON.stringify({
            event: 'authenticated',
            userId: userId,
            timestamp: Date.now()
          }));

        } catch (error) {
          console.error('❌ Ошибка авторизации:', error.message);
          ws.send(JSON.stringify({
            event: 'error',
            message: 'Неверный токен'
          }));
          ws.close(1008, 'Invalid token');
        }
        return;
      }

      // ============================================
      // 🔥 ПРОВЕРКА АВТОРИЗАЦИИ для других действий
      // ============================================
      
      if (!isAuthenticated) {
        ws.send(JSON.stringify({
          event: 'error',
          message: 'Не авторизован. Отправьте { action: "auth", token: "..." }'
        }));
        return;
      }

      // ============================================
      // 🔥 PING-PONG (для клиента)
      // ============================================
      
      if (message.action === 'ping') {
        ws.send(JSON.stringify({
          event: 'pong',
          timestamp: Date.now()
        }));
        return;
      }

      // Неизвестное действие
      console.log(`⚠️ Неизвестное действие от ${userId}:`, message.action);

    } catch (error) {
      console.error('❌ Ошибка обработки сообщения:', error);
      ws.send(JSON.stringify({
        event: 'error',
        message: 'Некорректный формат сообщения'
      }));
    }
  });

  // ============================================
  // 🔥 ОБРАБОТКА ЗАКРЫТИЯ СОЕДИНЕНИЯ
  // ============================================
  
  ws.on('close', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    if (userId && clients.has(userId)) {
      clients.get(userId).delete(ws);
      if (clients.get(userId).size === 0) {
        clients.delete(userId);
        console.log(`👋 Все подключения для ${userId} закрыты`);
      } else {
        console.log(`👋 Подключение закрыто для ${userId} (осталось: ${clients.get(userId).size})`);
      }
    } else {
      console.log('👋 Неавторизованное подключение закрыто');
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket ошибка:', error);
  });
  });
} // конец if (wss)

// ============================================
// 🔥 ПУБЛИЧНЫЕ ФУНКЦИИ ДЛЯ BROADCAST
// ============================================

/**
 * Отправить событие конкретному пользователю
 * @param {string} userId - ID пользователя
 * @param {string} event - Название события
 * @param {object} data - Данные события
 */
function sendToUser(userId, event, data) {
  if (!clients.has(userId)) {
    // Пользователь не подключен - это OK, просто игнорируем
    return;
  }

  const message = JSON.stringify({
    event,
    data,
    timestamp: Date.now()
  });

  const userClients = clients.get(userId);
  let sentCount = 0;

  userClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      sentCount++;
    }
  });

  if (sentCount > 0) {
    console.log(`📤 Событие "${event}" отправлено ${userId} (${sentCount} клиентов)`);
  }
}

/**
 * Broadcast всем подключенным клиентам (редко используется)
 * @param {string} event - Название события
 * @param {object} data - Данные события
 */
function broadcastToAll(event, data) {
  if (!wss) {
    console.warn('⚠️ WebSocket сервер не запущен, broadcast невозможен');
    return;
  }

  const message = JSON.stringify({
    event,
    data,
    timestamp: Date.now()
  });

  let sentCount = 0;
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      sentCount++;
    }
  });

  console.log(`📣 Broadcast "${event}" отправлен всем (${sentCount} клиентов)`);
}

/**
 * Получить количество активных подключений
 */
function getStats() {
  return {
    totalUsers: clients.size,
    totalConnections: wss ? wss.clients.size : 0,
    users: Array.from(clients.entries()).map(([userId, connections]) => ({
      userId,
      connections: connections.size
    }))
  };
}

// ============================================
// 🔥 GRACEFUL SHUTDOWN
// ============================================

if (wss) {
  process.on('SIGINT', () => {
    console.log('\n🛑 Получен SIGINT, закрываем Trades WebSocket...');
    
    wss.clients.forEach((ws) => {
      ws.close(1000, 'Server shutting down');
    });

    wss.close(() => {
      console.log('✅ Trades WebSocket закрыт');
      process.exit(0);
    });

    // Форс закрытие через 5 секунд
    setTimeout(() => {
      console.log('⚠️ Форсированное закрытие');
      process.exit(1);
    }, 5000);
  });
}

// ============================================
// 🔥 ЭКСПОРТ
// ============================================

module.exports = {
  wss,
  sendToUser,
  broadcastToAll,
  getStats,
  internalEmitter // ✅ Экспортируем для TradeWorker!
};

