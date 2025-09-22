const express = require('express');
const open = require('open');

const app = express();
const PORT = 52835;

app.use('/', express.static('.'));

app.listen(PORT, () => {
  console.log(`Server running`);
  open.default(`http://localhost:${PORT}`);
});