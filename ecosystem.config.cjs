module.exports = {
  apps: [
    {
      name: 'ada-chat-api',
      cwd: '/srv/www/node',
      script: './dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
      env_file:
        '/srv/www/node/.env.production',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file:
        '/srv/www/node/logs/error.log',
      out_file:
        '/srv/www/node/logs/combined.log',
      merge_logs: true,
      time: true,
      kill_timeout: 3000,
    },
  ],
};
