const mongoose = require('mongoose');

// Kết nối tới MongoDB Atlas (Chuỗi kết nối sẽ được cấu hình trong process.env.MONGODB_URI)
// Nếu chạy local mà chưa có biến môi trường thì báo lỗi
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.warn("⚠️ CHƯA CÓ MONGODB_URI. Đang tạm bỏ qua kết nối CSDL để tránh crash server.");
      return;
    }
    await mongoose.connect(mongoUri);
    console.log('MongoDB Connected successfully!');
  } catch (error) {
    console.error('MongoDB Connection Error:', error);
    process.exit(1);
  }
};

// Define Models (Mongoose Schemas)

const BannerSchema = new mongoose.Schema({
  image: { type: String, required: true }
});
const Banner = mongoose.model('Banner', BannerSchema);

const CategorySchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  image: { type: String, required: true }
});
const Category = mongoose.model('Category', CategorySchema);

const SubcategorySchema = new mongoose.Schema({
  categoryId: { type: Number, required: true, unique: true },
  items: { type: Array, default: [] }
});
const Subcategory = mongoose.model('Subcategory', SubcategorySchema);

const ProductSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  categoryId: { type: Number, required: true },
  subCategory: { type: String },
  price: { type: Number, required: true },
  originalPrice: { type: Number },
  image: { type: String, required: true },
  stock: { type: Number, default: 0 },
  details: { type: Array, default: [] },
  sizes: { type: Array, default: [] },
  colors: { type: Array, default: [] }
});
const Product = mongoose.model('Product', ProductSchema);

const OrderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // e.g. ORD-12345
  date: { type: String, required: true },
  customer: { type: Object, required: true },
  items: { type: Array, required: true },
  shippingFee: { type: Number, default: 0 },
  paymentMethod: { type: String, default: 'COD' },
  total: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  voucherCode: { type: String, default: 'NONE' },
  status: { type: String, default: 'pending' },
  paidAt: { type: String },
  paymentGateway: { type: String },
  cancelledAt: { type: String }
}, { timestamps: true });
const Order = mongoose.model('Order', OrderSchema);

const WarrantySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  date: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  rewardAmount: { type: Number },
  znsStatus: { type: String },
  znsMessage: { type: String }
}, { timestamps: true });
const Warranty = mongoose.model('Warranty', WarrantySchema);

module.exports = {
  connectDB,
  Banner,
  Category,
  Subcategory,
  Product,
  Order,
  Warranty
};
