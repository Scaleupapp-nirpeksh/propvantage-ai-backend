// File: routes/importRoutes.js
// Description: Admin "Import data" — upload Excel workbooks to validate or import, and
//   browse the history of every run. Gated by `data:import` (Owner / Business Head by default).

import express from 'express';
import multer from 'multer';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import { createImport, listImports, getImport } from '../controllers/importController.js';

const router = express.Router();

// Workbooks are held in memory for the length of the request and never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (/\.xlsx$/i.test(file.originalname)) return cb(null, true);
    return cb(new Error('Only Excel workbooks (.xlsx) can be imported'));
  },
});

router.use(protect);
router.use(hasPermission(PERMISSIONS.DATA.IMPORT));

router.post('/', upload.array('files', 12), createImport);
router.get('/', listImports);
router.get('/:id', getImport);

export default router;
