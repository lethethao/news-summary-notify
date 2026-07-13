module.exports = {
  apps: [
    {
      name: 'news_summary_notify',
      script: './index.js',
      cron_restart: '0 */4 * * *',
      autorestart: false,
    },
  ],
};
