const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Mongoose Models and Connection
const { connectDB, Banner, Category, Subcategory, Product, Order, Warranty } = require('./db');

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

// Basic Auth Middleware for Admin
const adminAuth = (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  if (login === 'admin' && password === (process.env.ADMIN_PASS || '123456')) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Vui lòng đăng nhập để truy cập trang quản trị.');
};

// Serve static admin file
app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin-only endpoints protection (Apply to modifying routes)
const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) return adminAuth(req, res, next);
  if (req.headers['x-admin-key'] === (process.env.ADMIN_PASS || '123456')) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// Image upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: imageUrl, filename: req.file.filename });
});

// 1. GET /banners
app.get('/banners', async (req, res) => {
  try {
    const banners = await Banner.find();
    res.json(banners.map(b => b.image));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

// 2. GET /categories
app.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find().sort({ id: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// 3. GET /products
app.get('/products', async (req, res) => {
  try {
    const categoryId = parseInt(req.query.categoryId);
    const query = !isNaN(categoryId) ? { categoryId } : {};
    const products = await Product.find(query).sort({ id: 1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /subcategories/:categoryId
app.get('/subcategories/:categoryId', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    const subcategory = await Subcategory.findOne({ categoryId });
    res.json(subcategory ? subcategory.items : []);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subcategories' });
  }
});

// GET /subcategories
app.get('/subcategories', async (req, res) => {
  try {
    const subcategories = await Subcategory.find();
    const result = {};
    subcategories.forEach(sub => {
      result[sub.categoryId] = sub.items;
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subcategories' });
  }
});

// POST /products
app.post('/products', requireAdmin, async (req, res) => {
  try {
    const newProductData = req.body;
    const newProduct = await Product.create(newProductData);
    res.status(201).json({ success: true, product: newProduct });
  } catch (err) {
    console.error('Error saving product:', err);
    res.status(500).json({ error: 'Failed to save product' });
  }
});

// DELETE /products/:id
app.delete('/products/:id', requireAdmin, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const deletedProduct = await Product.findOneAndDelete({ id: productId });
    
    if (!deletedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// PUT /products/:id
app.put('/products/:id', requireAdmin, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const updates = req.body;
    
    const updatedProduct = await Product.findOneAndUpdate({ id: productId }, updates, { new: true });
    
    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ success: true, product: updatedProduct });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Helper: Decrease stock for order items
async function decreaseStock(items) {
  try {
    for (const item of items) {
      const productId = item.product?.id || item.productId;
      if (productId) {
        await Product.findOneAndUpdate({ id: productId }, { $inc: { stock: -(item.quantity || 1) } });
      }
    }
  } catch (err) {
    console.error('Error updating stock:', err);
  }
}

// Helper: Restore stock for cancelled order items
async function restoreStock(items) {
  try {
    for (const item of items) {
      const productId = item.product?.id || item.productId;
      if (productId) {
        await Product.findOneAndUpdate({ id: productId }, { $inc: { stock: (item.quantity || 1) } });
      }
    }
  } catch (err) {
    console.error('Error restoring stock:', err);
  }
}

// 4. POST /orders
app.post('/orders', async (req, res) => {
  try {
    const orderData = req.body;
    if (!orderData || !orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ error: 'Order items are required' });
    }

    const needsPaymentConfirmation = orderData.paymentMethod === 'BANK' || orderData.paymentMethod === 'ZALOPAY';

    const orderId = `ORD-${Date.now()}`;
    const newOrder = await Order.create({
      id: orderId,
      date: new Date().toISOString(),
      customer: orderData.customer || { name: 'Anonymous', phone: '', address: '' },
      items: orderData.items,
      shippingFee: orderData.shippingFee || 30000,
      paymentMethod: orderData.paymentMethod || 'COD',
      total: orderData.total,
      discount: orderData.discount || 0,
      voucherCode: orderData.voucherCode || 'NONE',
      status: needsPaymentConfirmation ? 'awaiting_payment' : 'pending'
    });

    // Decrease product stock
    await decreaseStock(newOrder.items);

    if (newOrder.paymentMethod === 'ZALOPAY') {
      console.log(`[ZaloPay] Order ${newOrder.id} - Đang chờ khách hàng thanh toán qua ví ZaloPay...`);
    }

    if (newOrder.paymentMethod === 'BANK') {
      console.log(`[VietQR] Order ${newOrder.id} - chờ khách chuyển khoản ${newOrder.total}đ. Tự động xác nhận qua SePay/Casso webhook.`);
    }

    console.log(`New Order received successfully: ${newOrder.id}`);
    res.status(201).json({ success: true, order: newOrder });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// WEBHOOK: Third-party payment verification
app.post('/webhook/payment', async (req, res) => {
  try {
    const { transferAmount, description, content, gateway } = req.body;

    const transactionContent = content || description || '';
    const actualAmount = transferAmount ? Number(transferAmount) : 0;

    const orderIdMatch = transactionContent.match(/ORD[- ]?(\d+)/i);
    if (!orderIdMatch) {
      console.log(`[Webhook] Received transfer but no order ID found in: "${transactionContent}"`);
      return res.json({ success: false, message: 'No matching order ID in transfer description' });
    }

    const orderId = `ORD-${orderIdMatch[1]}`;
    const order = await Order.findOne({ id: orderId });

    if (!order) {
      console.log(`[Webhook] Order ${orderId} not found`);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (actualAmount < order.total) {
      console.log(`[Webhook] Amount mismatch: received ${actualAmount}, expected ${order.total}`);
      return res.json({ success: false, message: 'Transfer amount does not match order total' });
    }

    if (order.status === 'awaiting_payment') {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      order.paymentGateway = gateway || 'sepay_webhook';
      await order.save();

      console.log(`[Webhook] ✅ Payment CONFIRMED for order ${orderId} via ${gateway || 'sepay_webhook'}`);
      return res.json({ success: true, message: `Order ${orderId} payment confirmed` });
    }

    res.json({ success: false, message: `Order ${orderId} status is already: ${order.status}` });
  } catch (error) {
    console.error('Error in webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// PUT /orders/:id
app.put('/orders/:id', requireAdmin, async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status, customer } = req.body;
    
    const order = await Order.findOne({ id: orderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const oldStatus = order.status;
    const newStatus = status || oldStatus;

    if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
      await restoreStock(order.items);
      order.cancelledAt = new Date().toISOString();
      console.log(`[Stock] ✅ Stock restored for cancelled order ${orderId}`);
    }

    order.status = newStatus;

    if (customer) {
      order.customer = { ...order.customer, ...customer };
    }
    
    if (newStatus === 'paid' && !order.paidAt) {
      order.paidAt = new Date().toISOString();
    }
    
    await order.save();
    res.json({ success: true, order: order });
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// 5. GET /orders/:id
app.get('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findOne({ id: req.params.id });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// GET /orders/customer/:phone
app.get('/orders/customer/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const orders = await Order.find({ "customer.phone": phone }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customer orders' });
  }
});

// 6. GET /orders
app.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// 6. POST /warranty/activate
app.post('/warranty/activate', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const exists = await Warranty.findOne({ phone });
    if (exists) {
      return res.status(400).json({ error: 'Số điện thoại này đã kích hoạt bảo hành trước đó!' });
    }

    const znsMsg = `Cảm ơn ${name || 'Quý khách'} đã mua sản phẩm kính mắt tại Andu Eyewear. Chế độ bảo hành 12 tháng đã được kích hoạt thành công cho số điện thoại ${phone}. Voucher 30.000đ đã được cộng vào ví của bạn.`;

    const newWarranty = await Warranty.create({
      id: `WR-${Date.now()}`,
      date: new Date().toISOString(),
      name: name || 'Khách hàng Zalo',
      phone: phone,
      rewardAmount: 30000,
      znsStatus: 'sent',
      znsMessage: znsMsg
    });
    
    console.log(`[ZNS API] Mocking real ZNS call for ${phone}: ${znsMsg}`);

    res.status(201).json({ success: true, warranty: newWarranty });
  } catch (error) {
    console.error('Error activating warranty:', error);
    res.status(500).json({ error: 'Failed to activate warranty' });
  }
});

// 7. GET /warranty
app.get('/warranty', async (req, res) => {
  try {
    const warranties = await Warranty.find().sort({ createdAt: -1 });
    res.json(warranties);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch warranties' });
  }
});

// --- AUTO SEED LOGIC ---
const loadJsonFile = (filename) => {
  try {
    const filePath = path.join(__dirname, 'data', filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (error) {
    console.error(`Error loading ${filename}:`, error);
  }
  return null;
};

const initializeDatabase = async () => {
  try {
    // Only seed if MongoDB URI is provided
    if (!process.env.MONGODB_URI) return;
    
    const bannerCount = await Banner.countDocuments();
    if (bannerCount === 0) {
      console.log('MongoDB empty. Running auto-seed from JSON files...');
      
      const banners = loadJsonFile('banners.json');
      if (banners?.length) {
        const bannerDocs = banners.map(url => ({ image: url }));
        await Banner.insertMany(bannerDocs);
      }

      const categories = loadJsonFile('categories.json');
      if (categories?.length) await Category.insertMany(categories);

      const subcategories = loadJsonFile('subcategories.json');
      if (subcategories) {
        const subDocs = Object.entries(subcategories).map(([categoryId, items]) => ({
          categoryId: parseInt(categoryId),
          items
        }));
        if (subDocs.length) await Subcategory.insertMany(subDocs);
      }

      const products = loadJsonFile('products.json');
      if (products?.length) await Product.insertMany(products);

      const orders = loadJsonFile('orders.json');
      if (orders?.length) await Order.insertMany(orders);

      const warranties = loadJsonFile('warranties.json');
      if (warranties?.length) await Warranty.insertMany(warranties);
      
      console.log('MongoDB auto-seed completed successfully!');
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
};

// Start server
connectDB().then(() => {
  initializeDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`Andu Eyewear Backend is running on port ${PORT}`);
      console.log(`Connected to MongoDB Atlas / Local`);
    });
  });
});
