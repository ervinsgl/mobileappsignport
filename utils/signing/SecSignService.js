/**
 * SecSignService.js
 *
 * Backend service for direct SecSign Signature Portal calls.
 * Uses SECSIGN_CONNECT BTP destination (BasicAuthentication).
 * Credentials (User/Password) stored in destination — same pattern as CIService.
 *
 * TLS: rejectUnauthorized:false + keepAlive:false required for SecSign from CF.
 *
 * @file utils/signing/SecSignService.js
 */
const axios              = require('axios');
const https              = require('https');
const FormData           = require('form-data');
const DestinationService = require('../fsm/DestinationService');

class SecSignService {

    async triggerSigning({ pdfBuffer, fileName, userName, attachmentId, returnUrl }) {
        console.log(`[SecSignService] ── Signing trigger ─────────────────────`);

        // Step 1: resolve destination (URL + credentials)
        const dest       = await this._getDestConfig();
        const authHeader = this._basicAuth(dest.User, dest.Password);

        // Step 2: build form-data
        const steps = JSON.stringify([{
            action:  'simple-signature',
            signers: [{ name: userName, signer_type: 'user' }]
        }]);

        const redirectUrl = returnUrl || 'https://mobileappsignport-webcontainer-test-op.cfapps.eu10.hana.ondemand.com/';

        const form = new FormData();
        form.append('filenames',       pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
        form.append('steps',           steps);
        form.append('sigposbysigner',  'true');
        form.append('redirecturl',     redirectUrl);
        form.append('redirecttimeout', '3');

        console.log(`[SecSignService] URL:             ${dest.URL}`);
        console.log(`[SecSignService] User:            ${dest.User}`);
        console.log(`[SecSignService] File:            ${fileName}`);
        console.log(`[SecSignService] AttachmentId:    ${attachmentId}`);
        console.log(`[SecSignService] Signer:          ${userName}`);
        console.log(`[SecSignService] Steps:           ${steps}`);
        console.log(`[SecSignService] PDF size:        ${pdfBuffer.length} bytes`);
        console.log(`[SecSignService] Redirect URL:    ${redirectUrl}`);

        // Step 3: call SecSign
        console.log(`[SecSignService] Sending POST to SecSign...`);
        let response;
        try {
            response = await axios.post(dest.URL, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': authHeader
                },
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false,
                    keepAlive:          false
                }),
                timeout: 30000
            });
        } catch (error) {
            console.error(`[SecSignService] HTTP error:   ${error.response?.status} ${error.response?.statusText}`);
            console.error(`[SecSignService] Error body:   ${JSON.stringify(error.response?.data, null, 2)}`);
            console.error(`[SecSignService] Network code: ${error.code}`);
            console.error(`[SecSignService] Network msg:  ${error.message}`);
            throw error;
        }

        // Step 4: log response
        console.log(`[SecSignService] ── Response ────────────────────────────`);
        console.log(`[SecSignService] HTTP status:        ${response.status}`);
        console.log(`[SecSignService] Full response:      ${JSON.stringify(response.data, null, 2)}`);
        console.log(`[SecSignService] portfolioid:        ${response.data?.portfolioid}`);
        console.log(`[SecSignService] workflowid:         ${response.data?.workflowid}`);
        console.log(`[SecSignService] workflowstepid:     ${response.data?.workflowstepid}`);
        console.log(`[SecSignService] workflowstepurl:    ${response.data?.workflowstepurl}`);
        console.log(`[SecSignService] portfoliostate:     ${response.data?.portfoliostate}`);
        console.log(`[SecSignService] portfoliostatename: ${response.data?.portfoliostatename}`);
        console.log(`[SecSignService] isended:            ${response.data?.isended}`);
        console.log(`[SecSignService] iserror:            ${response.data?.iserror}`);
        console.log(`[SecSignService] ────────────────────────────────────────`);

        return response.data;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    async _getDestConfig() {
        console.log(`[SecSignService] Resolving SECSIGN_CONNECT destination...`);
        const destination = await DestinationService.getDestination('SECSIGN_CONNECT');
        const config      = destination.destinationConfiguration;
        console.log(`[SecSignService] Destination URL:  ${config.URL}`);
        console.log(`[SecSignService] Destination User: ${config.User}`);
        return config;
    }

    _basicAuth(user, password) {
        return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    }
}

module.exports = new SecSignService();