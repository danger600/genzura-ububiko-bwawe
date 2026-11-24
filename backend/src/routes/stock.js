import { Router } from "express";
import mongoose from "mongoose";
import { Product, StockMovement, StockRequest } from "../models/index.js";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { writeAudit } from "../utils/audit.js";

const router = Router();
router.use(requireAuth);

router.get("/movements", async (req, res, next) => {
  try {
    const filter = req.user.role === "Cashier" ? { type: "stockOut" } : {};
    const movements = await StockMovement.find(filter).sort({ date: -1 }).limit(500);
    res.json({ movements });
  } catch (error) {
    next(error);
  }
});

router.post("/movements", async (req, res, next) => {
  const { productId, type, qty } = req.body;
  const movementRoles = {
    stockIn: ["Admin", "Manager", "Storekeeper"],
    stockOut: ["Admin", "Manager", "Cashier"]
  };

  if (!movementRoles[type]?.includes(req.user.role)) {
    return res.status(403).json({ message: "Your role cannot create this stock movement." });
  }

  const amount = Number(qty);
  if (!mongoose.isValidObjectId(productId) || !Number.isInteger(amount) || amount < 1) {
    return res.status(400).json({ message: "Choose a valid product and a whole quantity greater than zero." });
  }

  const session = await mongoose.startSession();

  try {
    let createdMovement;

    await session.withTransaction(async () => {
      const product = await Product.findById(productId).session(session);
      if (!product) {
        const error = new Error("Product not found.");
        error.status = 404;
        throw error;
      }

      if (type === "stockOut" && product.qty < amount) {
        const error = new Error("There is not enough stock for this operation.");
        error.status = 409;
        throw error;
      }

      product.qty += type === "stockIn" ? amount : -amount;
      await product.save({ session });

      const reference = `MV-${Date.now()}`;
      const [movement] = await StockMovement.create([{
        reference,
        product: product._id,
        productName: product.name,
        type,
        qty: amount,
        unitPrice: product.price,
        total: type === "stockOut" ? amount * product.price : 0,
        date: req.body.date ? new Date(req.body.date) : new Date(),
        by: req.user.role,
        byName: req.user.name
      }], { session });

      await writeAudit(req.user, type === "stockIn" ? "STOCK_RECEIVED" : "STOCK_ISSUED", `${product.name} x${amount}`, session);
      createdMovement = movement;
    });

    res.status(201).json({ movement: createdMovement });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
});

router.get("/requests", async (req, res, next) => {
  try {
    const requests = await StockRequest.find().sort({ createdAt: -1 }).limit(500);
    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

router.post("/requests", allowRoles("Admin", "Manager", "Cashier", "Storekeeper"), async (req, res, next) => {
  try {
    const { productId, qty, notes = "" } = req.body;
    const amount = Number(qty);

    if (!mongoose.isValidObjectId(productId) || !Number.isInteger(amount) || amount < 1) {
      return res.status(400).json({ message: "Choose a valid product and enter a whole quantity greater than zero." });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found." });

    const request = await StockRequest.create({
      reference: `RQ-${Date.now()}`,
      product: product._id,
      productName: product.name,
      qty: amount,
      requestedBy: req.user.id,
      requestedByName: req.user.name,
      notes
    });

    await writeAudit(req.user, "STOCK_REQUEST_CREATED", request.reference);
    res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
});

router.patch("/requests/:id/status", allowRoles("Admin", "Manager"), async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    if (!["approved", "rejected", "processed"].includes(status)) {
      return res.status(400).json({ message: "Choose approved, rejected or processed." });
    }

    const request = await StockRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found." });
    if (request.status !== "pending" && !(request.status === "approved" && status === "processed")) {
      return res.status(409).json({ message: "This request has already been processed." });
    }

    request.status = status;
    request.processedBy = req.user.name;
    await request.save();
    await writeAudit(req.user, `REQUEST_${status.toUpperCase()}`, request.reference);
    res.json({ request });
  } catch (error) {
    next(error);
  }
});

export default router;
