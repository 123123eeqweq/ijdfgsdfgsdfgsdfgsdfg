/**
 * 🚀 Production launcher для Quotes System
 * 
 * Запускает в одном процессе:
 * 1. Все relay серверы (Polygon, Crypto, OTC) на внутренних портах
 * 2. Все listeners (агрегаторы свечей в MongoDB)
 * 3. Gateway на публичном порту (принимает внешние подключения)
 * 
 * Для деплоя на Render/Railway/etc
 */

const { spawn } = require('child_process');
const path = require('path');

// Цвета для логов
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const processes = new Map();

function log(prefix, color, message) {
  console.log(`${color}${prefix}${colors.reset} ${message}`);
}

function startProcess(name, script, color) {
  log(`[${name}]`, color, `🚀 Запуск...`);
  
  const child = spawn('node', [path.join(__dirname, script)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  processes.set(name, child);

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        log(`[${name}]`, color, line);
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        log(`[${name}]`, colors.red, `❌ ${line}`);
      }
    });
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`[${name}]`, colors.red, `💥 Процесс завершён с кодом ${code}`);
      // При падении одного процесса - останавливаем все
      shutdown();
    }
  });

  return child;
}

function shutdown() {
  log('[System]', colors.yellow, '🛑 Остановка всех процессов...');
  
  processes.forEach((child, name) => {
    try {
      child.kill('SIGTERM');
      log(`[${name}]`, colors.yellow, '✅ Остановлен');
    } catch (err) {
      log(`[${name}]`, colors.red, `❌ Ошибка остановки: ${err.message}`);
    }
  });

  setTimeout(() => {
    log('[System]', colors.green, '👋 Все процессы остановлены');
    process.exit(0);
  }, 2000);
}

// ============================================
// 🚀 ЗАПУСК ВСЕХ ПРОЦЕССОВ
// ============================================

console.log(`
${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════
  🌐 QUOTES SYSTEM - PRODUCTION MODE
═══════════════════════════════════════════════════════${colors.reset}

📡 Запуск Relay серверов (WebSocket источники)...
`);

// ШАГ 1: Запуск Relay серверов (внутренние порты)
const polygonRelay = startProcess('Polygon Relay', 'polygonRelay.js', colors.blue);
const cryptoRelay = startProcess('Crypto Relay', 'polygonCryptoRelay.js', colors.magenta);
const otcRelay = startProcess('OTC Relay', 'otcRelay.js', colors.cyan);

// Ждём 3 секунды чтобы relay серверы запустились
setTimeout(() => {
  console.log(`
${colors.bright}${colors.green}📊 Запуск Listeners (агрегаторы свечей)...${colors.reset}
`);
  
  // ШАГ 2: Запуск Listeners (агрегаторы)
  const polygonListener = startProcess('Polygon Listener', 'polygonListener.js', colors.blue);
  const cryptoListener = startProcess('Crypto Listener', 'polygonCryptoListener.js', colors.magenta);
  const otcListener = startProcess('OTC Listener', 'otcListener.js', colors.cyan);

  // Ждём ещё 2 секунды
  setTimeout(() => {
    console.log(`
${colors.bright}${colors.yellow}🌐 Запуск Gateway (публичный endpoint)...${colors.reset}
`);
    
    // ШАГ 3: Запуск Gateway (публичный порт)
    const gateway = startProcess('Gateway', 'quotesGateway.js', colors.green);

    setTimeout(() => {
      console.log(`
${colors.bright}${colors.green}═══════════════════════════════════════════════════════
  ✅ QUOTES SYSTEM ЗАПУЩЕН УСПЕШНО!
═══════════════════════════════════════════════════════${colors.reset}

📡 Активные компоненты:
   • Polygon Forex Relay   → ws://localhost:8080
   • Polygon Crypto Relay  → ws://localhost:8081
   • OTC Relay             → ws://localhost:8082
   • Gateway (публичный)   → PORT из переменной окружения

📊 Агрегаторы свечей:
   • Polygon Listener      → MongoDB (polygoncandles)
   • Crypto Listener       → MongoDB (polygoncryptocandles)
   • OTC Listener          → MongoDB (otccandles)

🌐 Публичный endpoint:
   Gateway принимает подключения на:
   - /forex  → Polygon Forex
   - /crypto → Polygon Crypto
   - /otc    → OTC

⚠️  Нажмите Ctrl+C для остановки всех процессов
${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}
`);
    }, 2000);
  }, 2000);
}, 3000);

// ============================================
// 🛑 GRACEFUL SHUTDOWN
// ============================================

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Обработка необработанных ошибок
process.on('uncaughtException', (err) => {
  log('[System]', colors.red, `💥 Необработанная ошибка: ${err.message}`);
  shutdown();
});

process.on('unhandledRejection', (reason) => {
  log('[System]', colors.red, `💥 Unhandled rejection: ${reason}`);
  shutdown();
});

