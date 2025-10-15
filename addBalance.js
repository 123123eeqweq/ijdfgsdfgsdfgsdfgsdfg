const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'vsepoluchitsa_db';

console.log('💰 Скрипт пополнения баланса запущен...\n');

mongoose.connect(MONGODB_URI, {
  dbName: DB_NAME
}).then(async () => {
  console.log('✅ MongoDB подключена\n');
  
  try {
    // Ищем единственного пользователя в базе
    const user = await User.findOne();
    
    if (!user) {
      console.log('❌ Пользователь не найден в базе данных');
      process.exit(1);
    }
    
    console.log('👤 Найден пользователь:');
    console.log(`   Email: ${user.email}`);
    console.log(`   Имя: ${user.firstName} ${user.lastName}`);
    console.log(`   Демо баланс: $${user.demoBalance.toFixed(2)}`);
    console.log(`   Реальный баланс: $${user.realBalance.toFixed(2)}\n`);
    
    // Устанавливаем балансы
    user.demoBalance = 10000;  // Демо счет
    user.realBalance = 1000;   // Реальный счет
    await user.save();
    
    console.log('✅ Балансы успешно обновлены!');
    console.log(`   Демо баланс: $${user.demoBalance.toFixed(2)} 💰`);
    console.log(`   Реальный баланс: $${user.realBalance.toFixed(2)} 💰\n`);
    
    console.log('🎉 Готово! Можно закрывать скрипт.\n');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Соединение с MongoDB закрыто');
    process.exit(0);
  }
  
}).catch(err => {
  console.error('❌ Ошибка подключения к MongoDB:', err.message);
  process.exit(1);
});

