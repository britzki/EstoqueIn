-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQuantity" REAL NOT NULL,
    "countedQuantity" REAL,
    "countedAt" DATETIME,
    "difference" REAL,
    CONSTRAINT "InventoryItem_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InventoryItem" ("countedAt", "countedQuantity", "difference", "expectedQuantity", "id", "inventoryId", "productId") SELECT "countedAt", "countedQuantity", "difference", "expectedQuantity", "id", "inventoryId", "productId" FROM "InventoryItem";
DROP TABLE "InventoryItem";
ALTER TABLE "new_InventoryItem" RENAME TO "InventoryItem";
CREATE UNIQUE INDEX "InventoryItem_inventoryId_productId_key" ON "InventoryItem"("inventoryId", "productId");
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "minStock" REAL NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fractional" BOOLEAN NOT NULL DEFAULT false,
    "sourceProductId" TEXT,
    "sourceYield" REAL,
    "supplierId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("active", "barcode", "category", "costCents", "createdAt", "description", "id", "minStock", "name", "priceCents", "sku", "supplierId", "unit", "updatedAt") SELECT "active", "barcode", "category", "costCents", "createdAt", "description", "id", "minStock", "name", "priceCents", "sku", "supplierId", "unit", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE TABLE "new_StockAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "threshold" REAL NOT NULL,
    "acknowledgedAt" DATETIME,
    "acknowledgedById" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockAlert_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockAlert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockAlert" ("acknowledgedAt", "acknowledgedById", "createdAt", "id", "productId", "quantity", "resolvedAt", "status", "threshold", "type", "updatedAt", "warehouseId") SELECT "acknowledgedAt", "acknowledgedById", "createdAt", "id", "productId", "quantity", "resolvedAt", "status", "threshold", "type", "updatedAt", "warehouseId" FROM "StockAlert";
DROP TABLE "StockAlert";
ALTER TABLE "new_StockAlert" RENAME TO "StockAlert";
CREATE INDEX "StockAlert_status_idx" ON "StockAlert"("status");
CREATE INDEX "StockAlert_productId_warehouseId_status_idx" ON "StockAlert"("productId", "warehouseId", "status");
CREATE TABLE "new_StockLevel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "minQuantity" REAL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StockLevel" ("id", "minQuantity", "productId", "quantity", "updatedAt", "warehouseId") SELECT "id", "minQuantity", "productId", "quantity", "updatedAt", "warehouseId" FROM "StockLevel";
DROP TABLE "StockLevel";
ALTER TABLE "new_StockLevel" RENAME TO "StockLevel";
CREATE UNIQUE INDEX "StockLevel_productId_warehouseId_key" ON "StockLevel"("productId", "warehouseId");
CREATE TABLE "new_StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "unitCostCents" INTEGER,
    "supplierId" TEXT,
    "documentRef" TEXT,
    "reason" TEXT,
    "transferId" TEXT,
    "inventoryId" TEXT,
    "nfeImportId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_nfeImportId_fkey" FOREIGN KEY ("nfeImportId") REFERENCES "NfeImport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StockMovement" ("balanceAfter", "createdAt", "documentRef", "id", "inventoryId", "nfeImportId", "productId", "quantity", "reason", "supplierId", "transferId", "type", "unitCostCents", "userId", "warehouseId") SELECT "balanceAfter", "createdAt", "documentRef", "id", "inventoryId", "nfeImportId", "productId", "quantity", "reason", "supplierId", "transferId", "type", "unitCostCents", "userId", "warehouseId" FROM "StockMovement";
DROP TABLE "StockMovement";
ALTER TABLE "new_StockMovement" RENAME TO "StockMovement";
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX "StockMovement_warehouseId_createdAt_idx" ON "StockMovement"("warehouseId", "createdAt");
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");
CREATE INDEX "StockMovement_transferId_idx" ON "StockMovement"("transferId");
CREATE TABLE "new_SupplierProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "conversionFactor" REAL NOT NULL DEFAULT 1,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SupplierProduct" ("conversionFactor", "createdAt", "description", "id", "productId", "supplierCode", "supplierId", "updatedAt") SELECT "conversionFactor", "createdAt", "description", "id", "productId", "supplierCode", "supplierId", "updatedAt" FROM "SupplierProduct";
DROP TABLE "SupplierProduct";
ALTER TABLE "new_SupplierProduct" RENAME TO "SupplierProduct";
CREATE INDEX "SupplierProduct_productId_idx" ON "SupplierProduct"("productId");
CREATE UNIQUE INDEX "SupplierProduct_supplierId_supplierCode_key" ON "SupplierProduct"("supplierId", "supplierCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

