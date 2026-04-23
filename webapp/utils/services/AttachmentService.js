/**
 * AttachmentService.js
 *
 * All attachment data operations for the signing app:
 *   - Load attachment list for an FSM object
 *   - Enrich each attachment with PDF content (preview + full base64)
 *   - Get the backend URL for serving a single PDF (for PDFViewer)
 *   - Merge multiple PDFs via the backend and return a viewer URL
 *
 * @file webapp/utils/services/AttachmentService.js
 * @module mobileappsignport/utils/services/AttachmentService
 */
sap.ui.define([], () => {
    "use strict";

    return {

        /**
         * Load all attachments for an FSM object and enrich each with PDF content.
         * @param {string} objectId - FSM cloudId from context
         * @returns {Promise<Array>} Enriched attachment objects:
         *   { id, fileName, type, content, contentFull, contentType, signed }
         */
        async loadAttachments(objectId) {
            console.log("[AttachmentService] Loading attachments | objectId:", objectId);

            const response = await fetch(`/api/attachments/${encodeURIComponent(objectId)}`);
            if (!response.ok) throw new Error(`Attachments fetch failed: HTTP ${response.status}`);

            const attachments = await response.json();
            console.log("[AttachmentService] Received:", attachments.length, "attachment(s)");

            const enriched = await Promise.all(
                attachments.map(att => this._fetchContent(att))
            );

            console.log("[AttachmentService] Enriched:", enriched.length, "attachment(s)");
            return enriched;
        },

        /**
         * Returns the backend URL to stream a single PDF directly.
         * Use this as the PDFViewer source — plain HTTP, no blob URLs.
         * @param {string} attachmentId
         * @returns {string} e.g. "/api/attachment-pdf/<id>"
         */
        getPdfUrl(attachmentId) {
            return `/api/attachment-pdf/${encodeURIComponent(attachmentId)}`;
        },

        /**
         * Merge multiple PDFs via the backend.
         * Returns a plain HTTP URL pointing to the cached merged PDF.
         * @param {string[]} attachmentIds
         * @returns {Promise<string>} URL e.g. "/api/attachments/merged/<uuid>"
         */
        async mergePdfs(attachmentIds) {
            console.log("[AttachmentService] Merging PDFs | ids:", attachmentIds);

            const response = await fetch("/api/attachments/merge", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ attachmentIds })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
                throw new Error(err.message || `Merge failed: HTTP ${response.status}`);
            }

            const result = await response.json();
            console.log("[AttachmentService] Merge complete | url:", result.url);
            return result.url;
        },

        /**
         * Download signed PDF from SecSign and upload to FSM as a new attachment.
         * @param {string} portfolioId      - from Step 1 SecSign response
         * @param {string} objectId         - FSM Activity cloudId
         * @param {string} objectType       - 'ACTIVITY' | 'SERVICECALL'
         * @param {string} originalFileName - e.g. "TEST.pdf"
         * @returns {Promise<{ attachmentId, fileName }>}
         */
        async uploadSignedPdf(portfolioId, objectId, objectType, originalFileName) {
            console.log("[AttachmentService] uploadSignedPdf | portfolioId:", portfolioId, "| objectId:", objectId);

            const response = await fetch("/api/attachments/upload-signed", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ portfolioId, objectId, objectType, originalFileName })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
                throw new Error(err.message || `Upload failed: HTTP ${response.status}`);
            }

            const result = await response.json();
            console.log("[AttachmentService] Signed PDF uploaded | attachmentId:", result.attachmentId, "| fileName:", result.fileName);
            return result;
        },

                // ── Private ───────────────────────────────────────────────────────

        /**
         * Fetch PDF binary content for a single attachment.
         * Returns the attachment extended with content fields.
         * Never throws — returns safe fallback values on error.
         * @private
         */
        async _fetchContent(attachment) {
            try {
                const response = await fetch(`/api/attachment-content/${encodeURIComponent(attachment.id)}`);

                if (!response.ok) {
                    console.warn(`[AttachmentService] Content fetch failed for ${attachment.id}: HTTP ${response.status}`);
                    return { ...attachment, content: "N/A", contentFull: null, contentType: "application/pdf", signed: false };
                }

                const result  = await response.json();
                const preview = result.base64 ? result.base64.substring(0, 60) + "..." : "N/A";

                console.log(`[AttachmentService] Content fetched | id: ${attachment.id} | size: ${result.base64?.length} chars`);

                return {
                    ...attachment,
                    content:     preview,
                    contentFull: result.base64,
                    contentType: result.contentType || "application/pdf",
                    signed:      false
                };

            } catch (error) {
                console.error(`[AttachmentService] Content error for ${attachment.id}:`, error.message);
                return { ...attachment, content: "Error", contentFull: null, contentType: "application/pdf", signed: false };
            }
        }
    };
});