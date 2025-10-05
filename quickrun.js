const express = require('express');
const open = require('open');

const app = express();
const PORT = 52835;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Accept, Accept-Encoding, Accept-Language, Authorization, Cache-Control, Connection, Content-Type, Host, Origin, Range, Referer, User-Agent');
  next();
});

app.use('/', express.static('.'));

app.listen(PORT, () => {
  console.log(`Server running`);
  open.default(`http://localhost:${PORT}`);
});