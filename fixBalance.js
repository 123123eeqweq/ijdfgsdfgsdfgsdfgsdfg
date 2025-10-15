const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'vsepoluchitsa_db';

console.log('🔧 Принудительное обновление структуры баланса\n');

mongoose.connect(MONGODB_URI, {
  dbName: DB_NAME
}).then(async () => {
  console.log('✅ MongoDB подключена\n');
  
  try {
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // Находим всех пользователей
    const users = await usersCollection.find().toArray();
    
    if (users.length === 0) {
      console.log('❌ Пользователи не найдены');
      process.exit(1);
    }
    
    console.log(`👥 Найдено пользователей: ${users.length}\n`);
    
    for (const user of users) {
      console.log(`📝 Обрабатываем: ${user.email}`);
      console.log(`   ID: ${user._id}`);
      
      // Принудительно обновляем структуру
      const updateResult = await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            demoBalance: 10000,  // Демо счет
            realBalance: 0       // Реальный счет
          },
          $unset: {
            balance: ""  // Удаляем старое поле
          }
        }
      );
      
      console.log(`   ✅ Обновлено: ${updateResult.modifiedCount} документ(ов)`);
      console.log(`   Демо баланс: $10,000.00`);
      console.log(`   Реальный баланс: $0.00\n`);
    }
    
    console.log('🎉 Все пользователи успешно обновлены!\n');
    
    // Проверяем результат
    console.log('🔍 Проверка результата:\n');
    const updatedUsers = await usersCollection.find().toArray();
    
    for (const user of updatedUsers) {
      console.log(`👤 ${user.email}:`);
      console.log(`   demoBalance: $${(user.demoBalance || 0).toFixed(2)}`);
      console.log(`   realBalance: $${(user.realBalance || 0).toFixed(2)}`);
      console.log(`   balance (старое): ${user.balance !== undefined ? '$' + user.balance.toFixed(2) : 'удалено ✅'}\n`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Соединение закрыто');
    process.exit(0);
  }
  
}).catch(err => {
  console.error('❌ Ошибка подключения к MongoDB:', err.message);
  process.exit(1);
});

