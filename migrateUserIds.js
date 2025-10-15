const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'vsepoluchitsa_db';

console.log('🔄 Миграция: Присвоение userId существующим пользователям\n');

mongoose.connect(MONGODB_URI, {
  dbName: DB_NAME
}).then(async () => {
  console.log('✅ MongoDB подключена\n');
  
  try {
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // Находим всех пользователей без userId
    const usersWithoutUserId = await usersCollection.find({ userId: { $exists: false } }).toArray();
    
    if (usersWithoutUserId.length === 0) {
      console.log('✅ Все пользователи уже имеют userId!\n');
      process.exit(0);
    }
    
    console.log(`👥 Найдено пользователей без userId: ${usersWithoutUserId.length}\n`);
    
    // Находим максимальный userId
    const userWithMaxId = await usersCollection.findOne({ userId: { $exists: true } }, { sort: { userId: -1 } });
    let nextUserId = userWithMaxId && userWithMaxId.userId ? userWithMaxId.userId + 1 : 1000000;
    
    console.log(`🔢 Начальный userId: ${nextUserId}\n`);
    
    // Присваиваем userId каждому пользователю
    for (const user of usersWithoutUserId) {
      await usersCollection.updateOne(
        { _id: user._id },
        { $set: { userId: nextUserId } }
      );
      
      console.log(`✅ ${user.email} → userId: ${nextUserId}`);
      nextUserId++;
    }
    
    console.log(`\n🎉 Миграция завершена! Присвоено ${usersWithoutUserId.length} userId\n`);
    
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

