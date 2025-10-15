const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'vsepoluchitsa_db';

console.log('🔄 Миграция: Присвоение tradeId существующим сделкам\n');

mongoose.connect(MONGODB_URI, {
  dbName: DB_NAME
}).then(async () => {
  console.log('✅ MongoDB подключена\n');
  
  try {
    const db = mongoose.connection.db;
    const tradesCollection = db.collection('trades');
    
    // Находим все сделки без tradeId
    const tradesWithoutId = await tradesCollection.find({ tradeId: { $exists: false } }).toArray();
    
    if (tradesWithoutId.length === 0) {
      console.log('✅ Все сделки уже имеют tradeId!\n');
      process.exit(0);
    }
    
    console.log(`📊 Найдено сделок без tradeId: ${tradesWithoutId.length}\n`);
    
    // Генерируем уникальные ID
    const usedIds = new Set();
    
    // Получаем все существующие tradeId
    const existingTrades = await tradesCollection.find({ tradeId: { $exists: true } }).toArray();
    existingTrades.forEach(trade => {
      if (trade.tradeId) {
        usedIds.add(trade.tradeId);
      }
    });
    
    console.log(`🔢 Существующих tradeId: ${usedIds.size}\n`);
    
    // Функция генерации уникального ID
    const generateUniqueId = () => {
      let id;
      let attempts = 0;
      do {
        id = Math.floor(10000000 + Math.random() * 90000000);
        attempts++;
      } while (usedIds.has(id) && attempts < 100);
      
      if (attempts >= 100) {
        throw new Error('Не удалось сгенерировать уникальный ID');
      }
      
      usedIds.add(id);
      return id;
    };
    
    // Присваиваем tradeId каждой сделке
    let updated = 0;
    for (const trade of tradesWithoutId) {
      const tradeId = generateUniqueId();
      
      await tradesCollection.updateOne(
        { _id: trade._id },
        { $set: { tradeId: tradeId } }
      );
      
      console.log(`✅ ${trade.pair} (${trade._id}) → tradeId: ${tradeId}`);
      updated++;
    }
    
    console.log(`\n🎉 Миграция завершена! Присвоено ${updated} tradeId\n`);
    
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

