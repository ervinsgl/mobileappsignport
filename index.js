/**
 * index.js
 *
 * Server entry point.
 * Registers middleware, mounts route files, serves static frontend, starts server.
 * All business logic lives in /routes and /utils.
 *
 * @file index.js
 */
const express = require('express');
const path    = require('path');

const contextRouter     = require('./routes/context');
const attachmentsRouter = require('./routes/attachments');
const signingRouter     = require('./routes/signing');

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────

app.use((req, res, next) => {
    // Required: allows FSM Mobile WebView and FSM Shell iframe to embed this app
    res.removeHeader('X-Frame-Options');
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.enable('trust proxy');

// ── Routes ─────────────────────────────────────────────────────────────────

app.use('/',    contextRouter);      // POST /web-container-access-point, GET /web-container-context
app.use('/api', attachmentsRouter);  // GET /api/attachments/*, GET /api/attachment-pdf/*, etc.
app.use('/api/signing', signingRouter); // POST /api/signing/trigger

// ── Static files (UI5 frontend) ────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'webapp')));

// ── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Server] FSM Signing app running on port ${PORT}`);
    console.log(`[Server] Web container entry:  POST /web-container-access-point`);
    console.log(`[Server] Signing target:        ${require('./utils/signing/signing.config').SIGNING_TARGET}`);
});