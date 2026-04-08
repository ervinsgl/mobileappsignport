/**
 * AttachmentService.js
 *
 * Handles all attachment data operations for the signing app.
 * Fetches the attachment list for an FSM object, then enriches
 * each entry with its PDF binary content (base64 preview + full).
 *
 * Returns a flat array ready to bind directly to the view model.
 *
 * @file webapp/utils/AttachmentService.js
 * @module mobileappsignport/utils/AttachmentService
 */
sap.ui.define([], () => {
    "use strict";

    return {

        /**
         * Load all attachments for a given FSM object and enrich each
         * with its PDF content (preview + full base64).
         *
         * @param {string} objectId - FSM cloudId from context
         * @returns {Promise<Array>} Array of enriched attachment objects:
         *   { id, fileName, type, content, contentFull, contentType, signed }
         */
        async loadAttachments(objectId) {
            console.log("[AttachmentService] Loading attachments for objectId:", objectId);

            const response = await fetch(`/api/attachments/${encodeURIComponent(objectId)}`);
            if (!response.ok) throw new Error(`Attachments fetch failed: HTTP ${response.status}`);

            const attachments = await response.json();
            console.log("[AttachmentService] Received:", attachments.length, "attachment(s)", attachments);

            const enriched = await Promise.all(
                attachments.map(att => this._fetchContent(att))
            );

            console.log("[AttachmentService] Enriched:", enriched.length, "attachment(s)");
            return enriched;
        },

        /**
         * Fetch PDF binary content for a single attachment.
         * Returns the attachment extended with content fields.
         * Never throws — returns safe fallback values on error.
         *
         * @param {Object} attachment - { id, fileName, type }
         * @returns {Promise<Object>} attachment + { content, contentFull, contentType, signed }
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