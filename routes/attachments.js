/**
 * routes/attachments.js
 *
 * All attachment-related API routes.
 * URL paths are kept identical to the original index.js routes
 * so no frontend changes are needed.
 *
 * Routes (mounted at /api):
 *   GET  /api/attachments/:objectId       ← list attachments for an FSM object
 *   GET  /api/attachment-content/:id      ← fetch base64 + contentType
 *   GET  /api/attachment-pdf/:id          ← pipe raw PDF binary (for PDFViewer)
 *   POST /api/attachments/merge           ← merge multiple PDFs
 *   GET  /api/attachments/merged/:uuid    ← serve a previously merged PDF
 */
const express         = require('express');
const { PDFDocument } = require('pdf-lib');
const FSMService      = require('../utils/fsm/FSMService');

const router = express.Router();

// ── Merged PDF temp cache ──────────────────────────────────────────────────

/**
 * Temporary store for merged PDFs.
 * Key: UUID, Value: { buffer, createdAt }
 * Entries expire after MERGED_TTL_MS. Cleaned every 10 minutes.
 */
const mergedCache   = {};
const MERGED_TTL_MS = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
    const cutoff  = Date.now() - MERGED_TTL_MS;
    let   removed = 0;
    Object.keys(mergedCache).forEach(key => {
        if (mergedCache[key].createdAt < cutoff) {
            delete mergedCache[key];
            removed++;
        }
    });
    if (removed > 0) console.log(`[Attachments] Merged cache cleanup: removed ${removed}`);
}, 10 * 60 * 1000);

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/attachments/:objectId
 * Returns all attachments linked to a given FSM object ID.
 * Response: [{ id, fileName, type }]
 */
router.get('/attachments/:objectId', async (req, res) => {
    const { objectId } = req.params;

    if (!objectId) {
        return res.status(400).json({ message: 'objectId is required' });
    }

    try {
        console.log(`[Attachments] GET list | objectId: ${objectId}`);
        const attachments = await FSMService.getAttachmentsForObject(objectId);
        console.log(`[Attachments] Returning ${attachments.length} item(s)`);
        return res.json(attachments);
    } catch (error) {
        console.error(`[Attachments] List error:`, error.message);
        return res.status(500).json({ message: 'Failed to fetch attachments', error: error.message });
    }
});

/**
 * GET /api/attachment-content/:attachmentId
 * Returns { base64, contentType } for a single attachment.
 */
router.get('/attachment-content/:attachmentId', async (req, res) => {
    const { attachmentId } = req.params;

    try {
        console.log(`[Attachments] GET content | id: ${attachmentId}`);
        const result = await FSMService.getAttachmentContent(attachmentId);
        console.log(`[Attachments] Content fetched | type: ${result.contentType}`);
        return res.json(result);
    } catch (error) {
        console.error(`[Attachments] Content error:`, error.message);
        return res.status(500).json({ message: 'Failed to fetch attachment content', error: error.message });
    }
});

/**
 * GET /api/attachment-pdf/:attachmentId
 * Pipes raw PDF binary directly to the browser.
 * Used as PDFViewer source – avoids Blob URL iframe security issues.
 */
router.get('/attachment-pdf/:attachmentId', async (req, res) => {
    const { attachmentId } = req.params;

    try {
        console.log(`[Attachments] GET pdf | id: ${attachmentId}`);
        const buffer = await FSMService.getAttachmentBuffer(attachmentId);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        res.send(buffer);
    } catch (error) {
        console.error(`[Attachments] PDF error:`, error.message);
        return res.status(500).json({ message: 'Failed to fetch PDF', error: error.message });
    }
});

/**
 * POST /api/attachments/merge
 * Fetches multiple PDFs from FSM, merges them with pdf-lib, stores the
 * result in the temp cache and returns a plain HTTP URL for PDFViewer.
 *
 * Body:    { attachmentIds: ["id1", "id2", ...] }
 * Returns: { url: "/api/attachments/merged/<uuid>" }
 */
router.post('/attachments/merge', async (req, res) => {
    const { attachmentIds } = req.body;

    if (!attachmentIds || !Array.isArray(attachmentIds) || attachmentIds.length < 2) {
        return res.status(400).json({ message: 'At least 2 attachmentIds required' });
    }

    console.log(`[Attachments] POST merge | ids: ${attachmentIds.join(', ')}`);

    try {
        const buffers = await Promise.all(
            attachmentIds.map(id => FSMService.getAttachmentBuffer(id))
        );
        console.log(`[Attachments] Buffers fetched | sizes: ${buffers.map(b => b.length + ' bytes').join(', ')}`);

        const merged = await PDFDocument.create();
        for (let i = 0; i < buffers.length; i++) {
            const doc   = await PDFDocument.load(buffers[i]);
            const pages = await merged.copyPages(doc, doc.getPageIndices());
            pages.forEach(p => merged.addPage(p));
            console.log(`[Attachments] Added ${attachmentIds[i]} | pages: ${doc.getPageCount()}`);
        }

        const mergedBuffer = Buffer.from(await merged.save());
        console.log(`[Attachments] Merge complete | total pages: ${merged.getPageCount()} | size: ${mergedBuffer.length} bytes`);

        const uuid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        mergedCache[uuid] = { buffer: mergedBuffer, createdAt: Date.now() };

        const url = `/api/attachments/merged/${uuid}`;
        console.log(`[Attachments] Cached at: ${url}`);
        return res.json({ url });

    } catch (error) {
        console.error(`[Attachments] Merge error:`, error.message);
        return res.status(500).json({ message: 'Failed to merge PDFs', error: error.message });
    }
});

/**
 * GET /api/attachments/merged/:uuid
 * Serves a previously merged PDF from the temp cache.
 */
router.get('/attachments/merged/:uuid', (req, res) => {
    const cached = mergedCache[req.params.uuid];
    if (!cached) {
        return res.status(404).json({ message: 'Merged PDF not found or expired' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="merged.pdf"');
    res.send(cached.buffer);
});

module.exports = router;