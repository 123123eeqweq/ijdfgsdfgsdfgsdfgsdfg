const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Запуск системы котировок...\n');

// Цвета для консоли
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

// Хранилище процессов для graceful shutdown
const processes = [];

// Функция для запуска процесса
function startProcess(name, script, color) {
  return new Promise((resolve) => {
    console.log(`${color}${colors.bright}▶ Запуск ${name}...${colors.reset}`);
    
    const proc = spawn('node', [script], {
      cwd: __dirname,
      stdio: 'pipe',
      shell: true
    });

    processes.push({ name, proc });

    // Префикс для логов
    const prefix = `${color}[${name}]${colors.reset}`;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => console.log(`${prefix} ${line}`));
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => console.error(`${prefix} ${line}`));
    });

    proc.on('close', (code) => {
      console.log(`${prefix} ${colors.yellow}Процесс завершён с кодом ${code}${colors.reset}`);
    });

    proc.on('error', (err) => {
      console.error(`${prefix} ${colors.yellow}Ошибка: ${err.message}${colors.reset}`);
    });

    // Даём процессу время на запуск
    setTimeout(() => {
      console.log(`${color}${colors.bright}✓ ${name} запущен${colors.reset}\n`);
      resolve();
    }, 1500); // 1.5 секунды на запуск каждого процесса
  });
}

// Функция задержки
function delay(ms, message) {
  return new Promise(resolve => {
    if (message) {
      console.log(`${colors.cyan}⏳ ${message}${colors.reset}\n`);
    }
    setTimeout(resolve, ms);
  });
}

// Graceful shutdown
function shutdown() {
  console.log('\n\n👋 Остановка всех процессов...\n');
  
  processes.forEach(({ name, proc }) => {
    console.log(`  🛑 Останавливаем ${name}...`);
    proc.kill('SIGINT');
  });

  setTimeout(() => {
    processes.forEach(({ proc }) => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    });
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Главная функция запуска
async function start() {
  try {
    console.log(`${colors.bright}═══════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}  📡 ШАГ 1: Запуск RELAY серверов (WebSocket)${colors.reset}`);
    console.log(`${colors.bright}═══════════════════════════════════════════════════════${colors.reset}\n`);

    // Запускаем все 3 relay одновременно (БЕЗ Trades WS - он отдельно!)
    await Promise.all([
      startProcess('Polygon Relay', 'polygonRelay.js', colors.blue),
      startProcess('Crypto Relay', 'polygonCryptoRelay.js', colors.green),
      startProcess('OTC Relay', 'otcRelay.js', colors.yellow)
    ]);

    // Ждём чтобы relay подключились к API
    await delay(3000, 'Ожидание подключения relay к внешним API... (3 сек)');

    console.log(`${colors.bright}═══════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}  🎯 ШАГ 2: Запуск LISTENER клиентов (агрегаторы)${colors.reset}`);
    console.log(`${colors.bright}═══════════════════════════════════════════════════════${colors.reset}\n`);

    // Запускаем все 3 listener одновременно
    await Promise.all([
      startProcess('Polygon Listener', 'polygonListener.js', colors.blue),
      startProcess('Crypto Listener', 'polygonCryptoListener.js', colors.green),
      startProcess('OTC Listener', 'otcListener.js', colors.yellow)
    ]);

    console.log(`${colors.bright}${colors.green}═══════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}${colors.green}  ✅ Система котировок запущена успешно!${colors.reset}`);
    console.log(`${colors.bright}${colors.green}═══════════════════════════════════════════════════════${colors.reset}\n`);

    console.log(`${colors.cyan}📊 Активные WebSocket серверы:${colors.reset}`);
    console.log(`   ${colors.blue}• ws://localhost:8080${colors.reset} — Polygon Forex (20 пар)`);
    console.log(`   ${colors.green}• ws://localhost:8081${colors.reset} — Polygon Crypto (10 пар)`);
    console.log(`   ${colors.yellow}• ws://localhost:8082${colors.reset} — OTC Synthetic (60 пар)\n`);
    
    console.log(`${colors.cyan}🔥 Для Trades WebSocket (Event-Driven):${colors.reset}`);
    console.log(`   Запустите отдельно: ${colors.bright}npm run trades${colors.reset}\n`);

    console.log(`${colors.cyan}💾 MongoDB коллекции:${colors.reset}`);
    console.log(`   • polygoncandles — Forex свечи`);
    console.log(`   • polygoncryptocandles — Crypto свечи`);
    console.log(`   • otccandles — OTC свечи\n`);

    console.log(`${colors.yellow}⚠️  Нажмите Ctrl+C для остановки всех процессов${colors.reset}\n`);

  } catch (error) {
    console.error(`${colors.yellow}❌ Ошибка запуска: ${error.message}${colors.reset}`);
    shutdown();
  }
}

// Запускаем
start();

