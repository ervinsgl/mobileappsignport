/**
 * index.js - Backend Server
 *
 * Express.js server for the FSM Mobile Web Container app.
 * Receives the FSM Mobile POST context, stores it per-session,
 * and serves the UI5 frontend.
 *
 * Session fix: each user gets their own context slot keyed by
 * userName + cloudId. Avoids one user's POST overwriting another's.
 * Sessions are cleaned up after 1 hour to prevent unbounded growth.
 *
 * @file index.js
 * @requires express
 */

const express         = require('express');
const path            = require('path');
const { PDFDocument } = require('pdf-lib');
const FSMService      = require('./utils/FSMService');
const CIService       = require('./utils/CIService');
const SecSignService  = require('./utils/SecSignService');
const { SIGNING_TARGET } = require('./utils/signing.config');

const app = express();

// ===========================
// SESSION CONTEXT STORAGE
// ===========================

/**
 * Map of sessionKey -> { ...fsmContext, _timestamp }
 * Key format: "<userName>-<cloudId>"
 * One entry per user+object combination, cleaned up after SESSION_TTL_MS.
 */
const sessions = {};
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Remove sessions older than SESSION_TTL_MS.
 * Runs every 10 minutes.
 */
setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let removed = 0;
    Object.keys(sessions).forEach(key => {
        if (sessions[key]._timestamp < cutoff) {
            delete sessions[key];
            removed++;
        }
    });
    if (removed > 0) {
        console.log(`Session cleanup: removed ${removed} expired session(s). Active: ${Object.keys(sessions).length}`);
    }
}, 10 * 60 * 1000);

// ===========================
// MIDDLEWARE
// ===========================
app.use((req, res, next) => {
    // Required: allows FSM Mobile WebView to embed this app
    res.removeHeader('X-Frame-Options');
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.enable('trust proxy');

// ===========================
// WEB CONTAINER ENTRY POINT
// ===========================

/**
 * Stores FSM Mobile context in the session map and redirects to the app root.
 * The session key is passed as a URL query param so the frontend can
 * retrieve exactly its own context, even if other users open simultaneously.
 *
 * @param {Object} body - FSM Mobile POST body
 * @param {Object} res  - Express response
 */
function handleMobilePost(body, res) {
    const userName = body?.userName || 'unknown';
    const cloudId  = body?.cloudId  || 'unknown';
    const key = `${userName}-${cloudId}`;

    sessions[key] = { ...body, _timestamp: Date.now() };

    console.log(`Web container opened | user: ${userName} | objectType: ${body?.objectType} | session: ${key}`);

    const host = res.req.protocol + '://' + res.req.get('host');
    res.redirect(`${host}/?session=${encodeURIComponent(key)}`);
}

/**
 * POST /web-container-access-point
 *
 * FSM Mobile sends a POST here when opening the web container.
 * Configure this URL in FSM Admin > Company > Web Containers.
 *
 * Context body contains:
 * { userName, authToken, cloudAccount, companyName, cloudId,
 *   objectType, language, dataCloudFullQualifiedDomainName }
 */
app.post('/web-container-access-point', (req, res) => {
    handleMobilePost(req.body || {}, res);
});

// Fallback: some FSM versions POST to root
app.post('/', (req, res) => {
    handleMobilePost(req.body || {}, res);
});

/**
 * GET /web-container-context?session=<key>
 *
 * Frontend calls this on load to retrieve its own stored context.
 * Returns 404 if no session key is provided or the key is not found
 * (e.g. app opened directly in a browser, or session expired).
 */
app.get('/web-container-context', (req, res) => {
    const key = req.query.session;

    if (!key) {
        return res.status(404).json({ message: 'No session key provided. Open from FSM Mobile.' });
    }

    const context = sessions[key];
    if (!context) {
        return res.status(404).json({ message: `Session '${key}' not found or expired.` });
    }

    // Return context without the internal timestamp field
    const { _timestamp, ...contextData } = context;
    return res.json(contextData);
});

// ===========================
// FSM API ROUTES
// ===========================

/**
 * GET /api/attachments/:objectId
 *
 * Returns all attachments linked to a given FSM object ID.
 * Calls FSM Query API: SELECT w FROM Attachment w WHERE w.object.objectId = '<objectId>'
 *
 * Response: [{ id, fileName, type }]
 */
app.get('/api/attachments/:objectId', async (req, res) => {
    const { objectId } = req.params;

    if (!objectId) {
        return res.status(400).json({ message: 'objectId is required' });
    }

    try {
        console.log(`[API] GET /api/attachments/${objectId}`);
        const attachments = await FSMService.getAttachmentsForObject(objectId);
        console.log(`[API] Returning ${attachments.length} attachment(s) for objectId: ${objectId}`);
        return res.json(attachments);
    } catch (error) {
        console.error(`[API] Error fetching attachments for ${objectId}:`, error.message);
        return res.status(500).json({ message: 'Failed to fetch attachments', error: error.message });
    }
});

/**
 * Temporary in-memory store for merged PDFs.
 * Key: UUID, Value: { buffer, createdAt }
 * Entries expire after MERGED_PDF_TTL_MS and are cleaned up every 10 min.
 */
const mergedPdfCache   = {};
const MERGED_PDF_TTL_MS = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
    const cutoff = Date.now() - MERGED_PDF_TTL_MS;
    let removed = 0;
    Object.keys(mergedPdfCache).forEach(key => {
        if (mergedPdfCache[key].createdAt < cutoff) {
            delete mergedPdfCache[key];
            removed++;
        }
    });
    if (removed > 0) console.log(`[API] Merged PDF cache cleanup: removed ${removed}`);
}, 10 * 60 * 1000);

/**
 * POST /api/attachments/merge
 *
 * Fetches multiple PDF attachments from FSM and merges them into one PDF.
 * Stores the result in a temporary cache and returns a plain HTTP URL.
 * The URL is then used directly as the PDFViewer source (blob URLs don't
 * work inside the PDFViewer's internal iframe).
 *
 * Body:    { attachmentIds: ["id1", "id2", ...] }
 * Returns: { url: "/api/attachments/merged/<uuid>" }
 */
app.post('/api/attachments/merge', async (req, res) => {
    const { attachmentIds } = req.body;

    if (!attachmentIds || !Array.isArray(attachmentIds) || attachmentIds.length < 2) {
        return res.status(400).json({ message: 'At least 2 attachmentIds required' });
    }

    console.log(`[API] POST /api/attachments/merge | ids: ${attachmentIds.join(', ')}`);

    try {
        // Fetch all PDF buffers from FSM in parallel
        const buffers = await Promise.all(
            attachmentIds.map(id => FSMService.getAttachmentBuffer(id))
        );
        console.log(`[API] Buffers fetched | sizes: ${buffers.map(b => b.length + ' bytes').join(', ')}`);

        // Merge with pdf-lib
        const merged = await PDFDocument.create();
        for (let i = 0; i < buffers.length; i++) {
            const doc   = await PDFDocument.load(buffers[i]);
            const pages = await merged.copyPages(doc, doc.getPageIndices());
            pages.forEach(p => merged.addPage(p));
            console.log(`[API] Added ${attachmentIds[i]} | pages: ${doc.getPageCount()}`);
        }

        const mergedBuffer = Buffer.from(await merged.save());
        console.log(`[API] Merge complete | total pages: ${merged.getPageCount()} | size: ${mergedBuffer.length} bytes`);

        // Store in temp cache, return a plain HTTP URL for PDFViewer
        const uuid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        mergedPdfCache[uuid] = { buffer: mergedBuffer, createdAt: Date.now() };

        const url = `/api/attachments/merged/${uuid}`;
        console.log(`[API] Merged PDF cached at: ${url}`);
        return res.json({ url });

    } catch (error) {
        console.error(`[API] Merge failed:`, error.message);
        return res.status(500).json({ message: 'Failed to merge PDFs', error: error.message });
    }
});

/**
 * GET /api/attachments/merged/:uuid
 *
 * Serves a previously merged PDF from the temp cache.
 */
app.get('/api/attachments/merged/:uuid', (req, res) => {
    const cached = mergedPdfCache[req.params.uuid];
    if (!cached) {
        return res.status(404).json({ message: 'Merged PDF not found or expired' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="merged.pdf"');
    res.send(cached.buffer);
});

/**
 * GET /api/attachment-content/:attachmentId
 *
 * Fetches the binary content of a single attachment from FSM.
 * Returns { base64, contentType } – base64-encoded PDF and its MIME type.
 */
app.get('/api/attachment-content/:attachmentId', async (req, res) => {
    const { attachmentId } = req.params;

    try {
        console.log(`[API] GET /api/attachment-content/${attachmentId}`);
        const result = await FSMService.getAttachmentContent(attachmentId);
        console.log(`[API] Content fetched for attachmentId: ${attachmentId} | type: ${result.contentType}`);
        return res.json(result);
    } catch (error) {
        console.error(`[API] Error fetching content for ${attachmentId}:`, error.message);
        return res.status(500).json({ message: 'Failed to fetch attachment content', error: error.message });
    }
});

/**
 * GET /api/attachment-pdf/:attachmentId
 *
 * Pipes the raw PDF binary from FSM directly to the browser.
 * Used as the PDFViewer source – avoids Blob URL iframe security issues.
 *
 * Response: raw PDF binary with Content-Type: application/pdf
 */
app.get('/api/attachment-pdf/:attachmentId', async (req, res) => {
    const { attachmentId } = req.params;

    try {
        console.log(`[API] GET /api/attachment-pdf/${attachmentId}`);
        const buffer = await FSMService.getAttachmentBuffer(attachmentId);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        res.send(buffer);
    } catch (error) {
        console.error(`[API] Error fetching PDF for ${attachmentId}:`, error.message);
        return res.status(500).json({ message: 'Failed to fetch PDF', error: error.message });
    }
});

/**
 * POST /api/signing/trigger
 *
 * Called when the user presses "Sign PDF".
 * Routing is controlled by SIGNING_TARGET in utils/signing.config.js:
 *   'ci'      → SAP CI only  (current)
 *   'secsign' → SecSign only
 *   'both'    → CI + SecSign in parallel
 *
 * Body: { attachmentId, fileName, objectId, userName, authToken }
 */
app.post('/api/signing/trigger', async (req, res) => {
    const { attachmentId, fileName, objectId, userName, authToken, returnUrl } = req.body;

    console.log(`[API] POST /api/signing/trigger | target: ${SIGNING_TARGET} | file: ${fileName} | user: ${userName}`);

    try {
        // Step 1: fetch PDF binary from FSM (needed by all targets)
        console.log(`[API] Fetching PDF buffer | attachmentId: ${attachmentId}`);
        const pdfBuffer = await FSMService.getAttachmentBuffer(attachmentId);
        console.log(`[API] PDF buffer ready | size: ${pdfBuffer.length} bytes`);

        const signingParams = { pdfBuffer, fileName, userName, authToken, attachmentId };
        let result;

        // Step 2: route to the configured target(s)
        if (SIGNING_TARGET === 'ci') {
            console.log('[API] Routing → SAP CI');
            result = await CIService.triggerSigning(signingParams);

        } else if (SIGNING_TARGET === 'secsign') {
            console.log('[API] Routing → SecSign');
            result = await SecSignService.triggerSigning(signingParams);

        } else if (SIGNING_TARGET === 'both') {
            console.log('[API] Routing → SAP CI + SecSign (parallel)');
            const [ciResult, secSignResult] = await Promise.all([
                CIService.triggerSigning(signingParams),
                SecSignService.triggerSigning(signingParams)
            ]);
            result = { ci: ciResult, secSign: secSignResult };

        } else {
            throw new Error(`Unknown SIGNING_TARGET: '${SIGNING_TARGET}'. Must be 'ci', 'secsign', or 'both'.`);
        }

        console.log(`[API] Signing trigger successful | target: ${SIGNING_TARGET}`);

        // Normalise result to always contain workflowstepurl.
        // Real SecSign returns it directly. CPI mock currently returns "Body" –
        // in that case we inject a mock URL pointing to our own mock-signing page.
        // Use returnUrl from frontend (includes ?session=xxx) so the app restores
        // its full context when the signing portal redirects back.
        const appBaseUrl   = `${req.protocol}://${req.get('host')}`;
        const appReturnUrl = returnUrl || `${appBaseUrl}/`;

        let workflowstepurl = result?.workflowstepurl || result?.data?.workflowstepurl;

        if (!workflowstepurl) {
            // CPI hasn't returned a real URL yet – use mock page
            workflowstepurl = `${appBaseUrl}/mock-signing.html`
                + `?portfolioId=MOCK-${Date.now()}`
                + `&attachmentId=${encodeURIComponent(attachmentId)}`
                + `&fileName=${encodeURIComponent(fileName)}`
                + `&redirectUrl=${encodeURIComponent(appReturnUrl)}`
                + `&redirectDeclineUrl=${encodeURIComponent(appReturnUrl)}`;

            console.log(`[API] No workflowstepurl – injecting mock URL: ${workflowstepurl}`);
            console.log(`[API] Return URL: ${appReturnUrl}`);
        }

        return res.json({
            success:         true,
            target:          SIGNING_TARGET,
            workflowstepurl: workflowstepurl,
            portfolioid:     result?.portfolioid || result?.data?.portfolioid || null,
            data:            result
        });

    } catch (error) {
        console.error(`[API] Signing trigger failed:`, error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ===========================
// STATIC FILES (UI5 frontend)
// ===========================
app.use(express.static(path.join(__dirname, 'webapp')));

// ===========================
// START SERVER
// ===========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`FSM Web Container app running on port ${PORT}`);
});