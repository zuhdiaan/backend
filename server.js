const express = require('express');
const mysql = require('mysql');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'r00t',
  database: 'jiwani_order',
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL: ' + err.stack);
    return;
  }
  console.log('Connected to MySQL as id ' + connection.threadId);
});

app.get('/api/menu_items', (req, res) => {
  let sql = 'SELECT * FROM menu_items';
  connection.query(sql, (err, results) => {
    if (err) {
      res.status(500).json({ error: 'Failed to fetch menu items' });
    } else {
      res.json(results);
    }
  });
});

app.post('/api/menu_items', (req, res) => {
  const { name, price, image_source, category } = req.body;
  const sql = 'INSERT INTO menu_items (name, price, image_source, category) VALUES (?, ?, ?, ?)';
  connection.query(sql, [name, price, image_source, category], (err, result) => {
    if (err) {
      console.error('Error inserting into database:', err);
      res.status(500).json({ error: 'Failed to add menu item' });
    } else {
      res.json({ id: result.insertId });
    }
  });
});


// Endpoint untuk mendapatkan semua pesanan
app.get('/api/orders', (req, res) => {
  let sql = 'SELECT * FROM orders';
  connection.query(sql, (err, results) => {
    if (err) {
      res.status(500).json({ error: 'Failed to fetch orders' });
    } else {
      res.json(results);
    }
  });
});

// Endpoint untuk membuat pesanan baru
app.post('/api/orders', (req, res) => {
  const { menu_id, table_number, payment_method } = req.body;
  const sql = 'INSERT INTO orders (menu_id, table_number, payment_status, payment_method, timestamp) VALUES (?, ?, "unpaid", ?, NOW())';
  connection.query(sql, [menu_id, table_number, payment_method], (err, result) => {
    if (err) {
      res.status(500).json({ error: 'Failed to create order' });
    } else {
      res.json({ id: result.insertId });
    }
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
