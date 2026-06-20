const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5005;

// Multer config for image upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `product-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Serve static admin file
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Image upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: imageUrl, filename: req.file.filename });
});

// Load static json files helper
const loadJsonFile = (filename) => {
  try {
    const filePath = path.join(__dirname, 'data', filename);
    const rawData = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(rawData);
  } catch (error) {
    console.error(`Error loading ${filename}:`, error);
    return [];
  }
};

// Database storage simulated in memory + json file
let orders = [];
const ordersFilePath = path.join(__dirname, 'data', 'orders.json');
try {
  if (fs.existsSync(ordersFilePath)) {
    orders = JSON.parse(fs.readFileSync(ordersFilePath, 'utf8'));
  }
} catch (e) {
  console.log("No order database yet, starting fresh.");
}

// 1. GET /banners - Get home page slider banners
app.get('/banners', (req, res) => {
  const banners = loadJsonFile('banners.json');
  res.json(banners);
});

// 2. GET /categories - Get list of eyewear categories
app.get('/categories', (req, res) => {
  const categories = loadJsonFile('categories.json');
  res.json(categories);
});

// 3. GET /products - Get list of products
app.get('/products', (req, res) => {
  const products = loadJsonFile('products.json');
  
  // Optional query filter by categoryId
  const categoryId = parseInt(req.query.categoryId);
  if (!isNaN(categoryId)) {
    const filtered = products.filter(p => p.categoryId === categoryId);
    return res.json(filtered);
  }
  
  res.json(products);
});

// GET /subcategories/:categoryId - Get subcategories for a category
app.get('/subcategories/:categoryId', (req, res) => {
  const allSubs = loadJsonFile('subcategories.json');
  const subs = allSubs[req.params.categoryId] || [];
  res.json(subs);
});

// GET /subcategories - Get all subcategories
app.get('/subcategories', (req, res) => {
  const allSubs = loadJsonFile('subcategories.json');
  res.json(allSubs);
});

// POST /products - Add new product
app.post('/products', (req, res) => {
  const products = loadJsonFile('products.json');
  const newProduct = req.body;
  
  // Assign new ID
  const maxId = products.reduce((max, p) => p.id > max ? p.id : max, 0);
  newProduct.id = maxId + 1;
  
  products.push(newProduct);
  
  try {
    const filePath = path.join(__dirname, 'data', 'products.json');
    fs.writeFileSync(filePath, JSON.stringify(products, null, 2), 'utf8');
    res.status(201).json({ success: true, product: newProduct });
  } catch (err) {
    console.error('Error saving products:', err);
    res.status(500).json({ error: 'Failed to save product' });
  }
});

// DELETE /products/:id - Delete a product
app.delete('/products/:id', (req, res) => {
  const productId = parseInt(req.params.id);
  let products = loadJsonFile('products.json');
  
  const initialLength = products.length;
  products = products.filter(p => p.id != productId);
  
  if (products.length === initialLength) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  try {
    const filePath = path.join(__dirname, 'data', 'products.json');
    fs.writeFileSync(filePath, JSON.stringify(products, null, 2), 'utf8');
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// PUT /products/:id - Edit a product
app.put('/products/:id', (req, res) => {
  const productId = parseInt(req.params.id);
  let products = loadJsonFile('products.json');
  
  const index = products.findIndex(p => p.id == productId);
  if (index === -1) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  // Merge updates into existing product
  const updates = req.body;
  products[index] = { ...products[index], ...updates, id: products[index].id };
  
  try {
    const filePath = path.join(__dirname, 'data', 'products.json');
    fs.writeFileSync(filePath, JSON.stringify(products, null, 2), 'utf8');
    res.json({ success: true, product: products[index] });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// 4. POST /orders - Create new order from Zalo Mini App
app.post('/orders', (req, res) => {
  const orderData = req.body;
  if (!orderData || !orderData.items || orderData.items.length === 0) {
    return res.status(400).json({ error: 'Order items are required' });
  }

  // Determine initial status based on payment method
  const needsPaymentConfirmation = orderData.paymentMethod === 'BANK' || orderData.paymentMethod === 'ZALOPAY';

  // Create a structured order record
  const newOrder = {
    id: `ORD-${Date.now()}`,
    date: new Date().toISOString(),
    customer: orderData.customer || { name: 'Anonymous', phone: '', address: '' },
    items: orderData.items,
    shippingFee: orderData.shippingFee || 30000,
    paymentMethod: orderData.paymentMethod || 'COD',
    total: orderData.total,
    discount: orderData.discount || 0,
    voucherCode: orderData.voucherCode || 'NONE',
    status: needsPaymentConfirmation ? 'awaiting_payment' : 'pending'
  };

  orders.unshift(newOrder);

  // Persist order to local JSON database
  try {
    fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing orders database:', err);
  }

  // ZaloPay: auto-confirmed by ZaloPay callback (simulated with 5s delay)
  if (newOrder.paymentMethod === 'ZALOPAY') {
    console.log(`[ZaloPay] Order ${newOrder.id} - chờ ZaloPay callback xác nhận...`);
    setTimeout(() => {
      const idx = orders.findIndex(o => o.id === newOrder.id);
      if (idx !== -1 && orders[idx].status === 'awaiting_payment') {
        orders[idx].status = 'paid';
        orders[idx].paidAt = new Date().toISOString();
        orders[idx].paymentGateway = 'zalopay';
        try {
          fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf8');
        } catch (err) {
          console.error('Error updating ZaloPay payment:', err);
        }
        console.log(`[ZaloPay] ✅ Payment CONFIRMED for order ${newOrder.id} via ZaloPay callback`);
      }
    }, 5000);
  }

  // BANK: admin xác nhận thủ công hoặc Casso/SePay webhook
  if (newOrder.paymentMethod === 'BANK') {
    console.log(`[VietQR] Order ${newOrder.id} - chờ admin xác nhận chuyển khoản ${newOrder.total}đ`);
  }

  console.log(`New Order received successfully: ${newOrder.id}`);
  res.status(201).json({ success: true, order: newOrder });
});

// WEBHOOK: Third-party payment verification (Casso, SePay, PayOS, etc.)
// Dịch vụ bên thứ 3 gọi endpoint này khi phát hiện giao dịch chuyển khoản mới
// Docs: https://docs.casso.vn/webhook | https://docs.sepay.vn/webhook
app.post('/webhook/payment', (req, res) => {
  const { transferAmount, description, content, gateway } = req.body;

  // SePay dùng 'content', Casso dùng 'description'
  const transactionContent = content || description || '';
  const actualAmount = transferAmount ? Number(transferAmount) : 0;

  // Trích xuất mã đơn hàng - hỗ trợ cả ORD-xxx và ORDxxx (ngân hàng có thể bỏ dấu -)
  const orderIdMatch = transactionContent.match(/ORD[- ]?(\d+)/i);
  
  if (!orderIdMatch) {
    console.log(`[Webhook] Received transfer but no order ID found in: "${transactionContent}"`);
    return res.json({ success: false, message: 'No matching order ID in transfer description' });
  }

  // Luôn tạo lại dạng chuẩn ORD-xxxxx để khớp với database
  const orderId = `ORD-${orderIdMatch[1]}`;
  const orderIndex = orders.findIndex(o => o.id === orderId);

  if (orderIndex === -1) {
    console.log(`[Webhook] Order ${orderId} not found`);
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const order = orders[orderIndex];

  // Kiểm tra số tiền khớp (cho phép chênh lệch nhẹ hoặc bằng/lớn hơn số tiền đơn hàng)
  if (actualAmount < order.total) {
    console.log(`[Webhook] Amount mismatch: received ${actualAmount}, expected ${order.total}`);
    return res.json({ success: false, message: 'Transfer amount does not match order total' });
  }

  // Xác nhận thanh toán
  if (order.status === 'awaiting_payment') {
    orders[orderIndex].status = 'paid';
    orders[orderIndex].paidAt = new Date().toISOString();
    orders[orderIndex].paymentGateway = gateway || 'sepay_webhook';

    try {
      fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf8');
    } catch (err) {
      console.error('Error updating payment status:', err);
    }

    console.log(`[Webhook] ✅ Payment CONFIRMED for order ${orderId} via ${gateway || 'sepay_webhook'}`);
    return res.json({ success: true, message: `Order ${orderId} payment confirmed` });
  }

  res.json({ success: false, message: `Order ${orderId} status is already: ${order.status}` });
});

// PUT /orders/:id - Update order status (mark completed)
app.put('/orders/:id', (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;
  
  const orderIndex = orders.findIndex(o => o.id === orderId);
  if (orderIndex === -1) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  const newStatus = status || orders[orderIndex].status;
  orders[orderIndex].status = newStatus;
  
  // Track payment confirmation time
  if (newStatus === 'paid' && !orders[orderIndex].paidAt) {
    orders[orderIndex].paidAt = new Date().toISOString();
  }
  
  try {
    fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf8');
    res.json({ success: true, order: orders[orderIndex] });
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// 5. GET /orders/:id - Get single order (for payment polling)
app.get('/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json(order);
});

// 6. GET /orders - Get list of placed orders (for admin review)
app.get('/orders', (req, res) => {
  res.json(orders);
});

// Database storage for warranties
let warranties = [];
const warrantiesFilePath = path.join(__dirname, 'data', 'warranties.json');
try {
  if (fs.existsSync(warrantiesFilePath)) {
    warranties = JSON.parse(fs.readFileSync(warrantiesFilePath, 'utf8'));
  }
} catch (e) {
  console.log("No warranty database yet, starting fresh.");
}

// 6. POST /warranty/activate - Activate warranty and trigger ZNS
app.post('/warranty/activate', (req, res) => {
  const { name, phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  const exists = warranties.some(w => w.phone === phone);
  if (exists) {
    return res.status(400).json({ error: 'Số điện thoại này đã kích hoạt bảo hành trước đó!' });
  }

  const newWarranty = {
    id: `WR-${Date.now()}`,
    date: new Date().toISOString(),
    name: name || 'Khách hàng Zalo',
    phone: phone,
    rewardAmount: 30000,
    znsStatus: 'sent',
    znsMessage: `Cảm ơn ${name || 'Quý khách'} đã mua sản phẩm kính mắt tại Andu Eyewear. Chế độ bảo hành 12 tháng đã được kích hoạt thành công cho số điện thoại ${phone}. Voucher 30.000đ đã được cộng vào ví của bạn.`
  };

  warranties.unshift(newWarranty);

  try {
    fs.writeFileSync(warrantiesFilePath, JSON.stringify(warranties, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing warranties database:', err);
  }

  res.status(201).json({ success: true, warranty: newWarranty });
});

// 7. GET /warranty - Retrieve warranty logs
app.get('/warranty', (req, res) => {
  res.json(warranties);
});

app.listen(PORT, () => {
  console.log(`Andu Eyewear Backend is running on port ${PORT}`);
});
