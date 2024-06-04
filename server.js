const express = require('express');
const mysql = require('mysql');
const midtransClient = require('midtrans-client');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const port = 3000;
const multer  = require('multer')
const upload = multer({ dest: 'public/uploads/' })
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

app.use(bodyParser.json());
app.use(cors());

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

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
  serverKey: process.env.SECRET,
});

console.log('Midtrans Server Key:', process.env.SECRET);

app.post('/api/order', async (req, res) => {
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

    const insertOrderPromises = orderedItems.map(item => {
      const sqlOrder = `
        INSERT INTO orders (order_id, transaction_token, order_date, item_id, item_name, quantity, item_price, total_price)
        VALUES (?, ?, DEFAULT, ?, ?, ?, ?, ?)
      `;
      return new Promise((resolve, reject) => {
        connection.query(sqlOrder, [orderId, transactionToken, item.id, item.name, item.quantity, item.price, grossAmount], (err, result) => {
          if (err) {
            console.error('Error inserting into orders table:', err);
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
    });

    await Promise.all(insertOrderPromises);
    res.json({ transactionToken });
  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/order', (req, res) => {
  const sql = `
    SELECT order_id, transaction_token, order_date, 
           GROUP_CONCAT(CONCAT(item_id, ':', item_name, ':', quantity, ':', item_price)) AS items, 
           total_price
    FROM orders
    GROUP BY order_id, transaction_token, order_date, total_price
  `;
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching orders from database:', err);
      res.status(500).json({ error: 'Failed to fetch orders' });
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

app.post('/api/menu_items', upload.single('avatar'), async (req, res) => {
  try {
    const { name, price, category } = req.body;
    const uploadedFile = req.file;

    // Sanitize the filename
    const sanitizedFilename = name.toLowerCase().replace(/\s+/g, '-');
    const originalExtension = path.extname(uploadedFile.originalname);

    // Create the target directory if it doesn't exist
    const targetDirectory = path.join(__dirname, 'public', 'uploads');
    await fs.mkdir(targetDirectory, { recursive: true });

    // Move the file to the target directory with the sanitized filename and original extension
    const targetPath = path.join(targetDirectory, sanitizedFilename + originalExtension);
    await fs.rename(uploadedFile.path, targetPath);

    console.log('File moved successfully');

    // Insert menu item into the database
    const sql = 'INSERT INTO menu_items (name, price, image_source, category) VALUES (?, ?, ?, ?)';
    connection.query(sql, [name, price, sanitizedFilename + originalExtension, category], (err, result) => {
      if (err) {
        console.error('Error inserting into database:', err);
        res.status(500).json({ error: 'Failed to add menu item' });
      } else {
        res.json({ id: result.insertId });
      }
    });
  } catch (err) {
    console.error('Error handling request:', err);
    res.status(500).json({ error: 'Failed to process the request' });
  }
});

app.get('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const fileUrl = `${baseUrl}/uploads/${filename}`;
  res.json({ url: fileUrl });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
