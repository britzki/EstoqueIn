import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { currentUser, requirePermission } from '../../middleware/auth.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { importDecisionsSchema, importNfe, previewNfe } from './nfe.service.js';

export const nfeRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const isXml = file.originalname.toLowerCase().endsWith('.xml') || file.mimetype.includes('xml');
    if (!isXml) return callback(badRequest('Envie o arquivo .xml da NF-e'));
    callback(null, true);
  },
});

const readXml = (file?: Express.Multer.File) => {
  if (!file) throw badRequest('Envie o XML no campo "file"');
  return file.buffer.toString('utf8').replace(/^﻿/, '');
};

nfeRoutes.get('/', async (_req, res) => {
  const imports = await prisma.nfeImport.findMany({
    include: {
      supplier: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json(imports);
});

nfeRoutes.post('/preview', requirePermission('stock:move'), upload.single('file'), async (req, res) => {
  res.json(await previewNfe(readXml(req.file)));
});

nfeRoutes.post('/import', requirePermission('stock:move'), upload.single('file'), async (req, res) => {
  let raw: unknown;
  try {
    raw = JSON.parse(String(req.body.decisions ?? ''));
  } catch {
    throw badRequest('Campo "decisions" inválido');
  }
  const decisions = importDecisionsSchema.parse(raw);
  const result = await importNfe(readXml(req.file), decisions, currentUser(req));
  await recordAudit(actorOf(req), {
    action: 'IMPORT',
    entity: 'NfeImport',
    entityId: result.importId,
    summary:
      `NF-e ${result.number} de ${result.supplier.name} importada: ${result.summary.items} item(ns)` +
      (result.summary.createdProducts ? `, ${result.summary.createdProducts} produto(s) novo(s)` : ''),
  });
  res.status(201).json(result);
});
