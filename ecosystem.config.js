module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'npm',
      args: 'run backend',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 5000
      }
    },
    {
      name: 'quotes',
      script: 'npm',
      args: 'run quotes',
      env: {
        NODE_ENV: 'production',
        QUOTES_PORT: process.env.QUOTES_PORT || 3001
      }
    },
    {
      name: 'trades',
      script: 'npm',
      args: 'run trades', 
      env: {
        NODE_ENV: 'production',
        TRADES_PORT: process.env.TRADES_PORT || 3002
      }
    }
  ]
};
