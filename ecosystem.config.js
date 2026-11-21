module.exports = {
  apps: [
    {
      name: 'openclaw-article-batch-generator',
      script: 'scripts/generate-articles.js',
      cwd: __dirname,
      interpreter: 'node',
      args: '--all',
      instances: 1,
      autorestart: false,
      cron_restart: '0 9 */3 * *',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
      },
      out_file: './cron.log',
      error_file: './cron-error.log',
      merge_logs: true,
      time: true
    }
  ]
};
