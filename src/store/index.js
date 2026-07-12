const config = require('../config');

const store = config.databaseUrl
  ? require('./postgresStore')
  : require('./jsonStore');

module.exports = store;
