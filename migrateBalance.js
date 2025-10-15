const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'vsepoluchitsa_db';

console.log('🔄 Миграция балансов: balance → demoBalance + realBalance\n');

mongoose.connect(MONGODB_URI, {
  dbName: DB_NAME
}).then(async () => {
  console.log('✅ MongoDB подключена\n');
  
  try {
    // Находим всех пользователей
    const users = await User.find();
    
    if (users.length === 0) {
      console.log('❌ Пользователи не найдены в базе данных');
      process.exit(1);
    }
    
    console.log(`👥 Найдено пользователей: ${users.length}\n`);
    
    for (const user of users) {
      console.log(`📝 Обрабатываем: ${user.email}`);
      
      // Если есть старое поле balance
      if (user.balance !== undefined) {
        console.log(`   Старый balance: $${user.balance.toFixed(2)}`);
        
        // Если новые поля еще не установлены, используем значения по умолчанию
        if (user.demoBalance === undefined) {
          user.demoBalance = 10000; // Демо по умолчанию
        }
        if (user.realBalance === undefined) {
          user.realBalance = 0; // Реальный по умолчанию
        }
        
        // Удаляем старое поле (MongoDB позволяет)
        user.balance = undefined;
        
        await user.save();
        
        console.log(`   ✅ Обновлено:`);
        console.log(`      Демо баланс: $${user.demoBalance.toFixed(2)}`);
        console.log(`      Реальный баланс: $${user.realBalance.toFixed(2)}\n`);
      } else {
        // Пользователь уже мигрирован
        console.log(`   ℹ️  Уже мигрирован:`);
        console.log(`      Демо баланс: $${user.demoBalance.toFixed(2)}`);
        console.log(`      Реальный баланс: $${user.realBalance.toFixed(2)}\n`);
      }
    }
    
    console.log('🎉 Миграция успешно завершена!\n');
    
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

