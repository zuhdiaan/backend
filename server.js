const express = require('express');
const mysql = require('mysql');
const midtransClient = require('midtrans-client');
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

let snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: 'SB-Mid-server-tD8SJfEzpjbmMW2_t06AK37u',
});

app.post('/api/transaction', async (req, res) => {
  const { orderId, grossAmount, customerDetails, orderedItems } = req.body;

  try {
    let parameter = {
      "transaction_details": {
        "order_id": orderId,
        "gross_amount": grossAmount,
      },
      "credit_card": {
        "secure": true
      },
      "customer_details": customerDetails
    };

    const transaction = await snap.createTransaction(parameter);
    const transactionToken = transaction.token;

    const sqlTransaction = 'INSERT INTO transactions (order_id, transaction_token) VALUES (?, ?)';
    connection.query(sqlTransaction, [orderId, transactionToken], (err, result) => {
      if (err) {
        console.error('Error inserting into transactions table:', err);
        res.status(500).json({ error: 'Failed to store transaction token' });
      } else {
        const transactionId = result.insertId;
        const sqlOrderDetails = 'INSERT INTO order_details (order_id, item_id, quantity) VALUES ?';
        const orderDetailsValues = orderedItems.map(item => [orderId, item.id, item.quantity]);

        connection.query(sqlOrderDetails, [orderDetailsValues], (err, result) => {
          if (err) {
            console.error('Error inserting into order_details table:', err);
            res.status(500).json({ error: 'Failed to store order details' });
          } else {
            res.json({ transactionToken });
          }
        });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transaction', (req, res) => {
  const sql = `
    SELECT t.id, t.order_id, t.transaction_token, 
           GROUP_CONCAT(CONCAT(od.item_id, ':', od.quantity)) AS items
    FROM transactions t
    LEFT JOIN order_details od ON t.order_id = od.order_id
    GROUP BY t.id, t.order_id, t.transaction_token
  `;
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching transactions from database:', err);
      res.status(500).json({ error: 'Failed to fetch transactions' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/order_details', (req, res) => {
  const sql = `
    SELECT od.order_id, mi.name, od.quantity 
    FROM order_details od
    JOIN menu_items mi ON od.item_id = mi.id
  `;
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching order details from database:', err);
      res.status(500).json({ error: 'Failed to fetch order details' });
    } else {
      res.json(results);
    }
  });
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
