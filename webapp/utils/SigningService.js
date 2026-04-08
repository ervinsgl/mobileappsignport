/**
 * SigningService.js
 *
 * Frontend service for document signing operations.
 * Calls the backend signing route which forwards to SAP CI.
 *
 * @file webapp/utils/SigningService.js
 * @module mobileappsignport/utils/SigningService
 */
sap.ui.define([], () => {
    "use strict";

    return {

        /**
         * Trigger the signing workflow for an attachment.
         * Backend fetches the PDF binary from FSM and forwards it to SAP CI.
         *
         * @param {Object} attachment       - Attachment row object from model
         * @param {string} attachment.id
         * @param {string} attachment.fileName
         * @param {Object} context          - FSM context from model
         * @param {string} context.cloudId
         * @param {string} context.userName
         * @returns {Promise<Object>}       - Backend response { success, data }
         */
        triggerSigning(attachment, context) {
            const payload = {
                attachmentId: attachment.id,
                fileName:     attachment.fileName,
                objectId:     context.cloudId,
                userName:     context.userName,
                authToken:    context.authToken   // passed to SecSignService when target = 'secsign' or 'both'
            };

            console.log("[SigningService] Triggering signing | payload:", payload);

            return fetch("/api/signing/trigger", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(payload)
            })
            .then(response => {
                console.log("[SigningService] Response status:", response.status);
                if (!response.ok) {
                    return response.json().then(err => {
                        throw new Error(err.message || `HTTP ${response.status}`);
                    });
                }
                return response.json();
            })
            .then(result => {
                console.log("[SigningService] Success | result:", result);
                return result;
            })
            .catch(error => {
                console.error("[SigningService] Error:", error.message);
                throw error;
            });
        }
    };
});