/**
 * SecSignService.js
 *
 * Backend service for direct SecSign Signature Portal calls.
 * Uses the SECSIGN_CONNECT BTP destination (NoAuthentication) for the URL only.
 * Authentication is done via the FSM authToken passed from context.
 *
 * The FSM authToken from context is used directly as the Basic auth header value:
 *   Authorization: Basic <authToken>
 *
 * SecSign API endpoint:
 *   POST /rest/signatureportal/v1/SPWorkflow/Start
 *
 * Multipart/form-data fields (same structure as CIService):
 *   filenames          – binary PDF (file field)
 *   workflowname       – workflow label
 *   steps              – JSON string with signer details
 *   sigposbysigner     – "true"
 *   informsignertosign – "false"
 *
 * Expected response from SecSign:
 * {
 *   portfolioid:     4100,
 *   workflowstepurl: "https://signaturportalq.tuev-nord.de/.../WorkflowStep/103420",
 *   isended:         false,
 *   ...
 * }
 *
 * @file utils/SecSignService.js
 * @requires axios
 * @requires form-data
 * @requires ./DestinationService
 */
const axios              = require('axios');
const FormData           = require('form-data');
const DestinationService = require('../fsm/DestinationService');

class SecSignService {

    // =========================================================================
    // SIGNING
    // =========================================================================

    /**
     * Trigger a signing workflow directly on SecSign Signature Portal.
     *
     * @param {Object} params
     * @param {Buffer} params.pdfBuffer    - Raw PDF binary fetched from FSM
     * @param {string} params.fileName     - PDF file name (e.g. "TEST.pdf")
     * @param {string} params.userName     - FSM user name – used as signer name
     * @param {string} params.authToken    - FSM auth token used as Basic auth value
     * @param {string} params.attachmentId - FSM attachment ID (for logging)
     * @returns {Promise<Object>} SecSign response (portfolioid, workflowstepurl, ...)
     */
    async triggerSigning({ pdfBuffer, fileName, userName, authToken, attachmentId }) {
        const url = await this._getUrl();

        // Build steps JSON – signer name comes from FSM context userName
        const steps = JSON.stringify([{
            signers: [{ name: userName, signer_type: 'user' }],
            action:  'simple-signature'
        }]);

        // Build multipart/form-data – identical field structure to CIService
        const form = new FormData();
        form.append('filenames',           pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
        form.append('workflowname',        'Test Workflow');
        form.append('steps',               steps);
        form.append('sigposbysigner',      'true');
        form.append('informsignertosign',  'false');

        console.log(`[SecSignService] Triggering signing workflow`);
        console.log(`[SecSignService] URL:          ${url}`);
        console.log(`[SecSignService] File:         ${fileName}`);
        console.log(`[SecSignService] AttachmentId: ${attachmentId}`);
        console.log(`[SecSignService] Signer:       ${userName}`);
        console.log(`[SecSignService] Steps:        ${steps}`);
        console.log(`[SecSignService] PDF size:     ${pdfBuffer.length} bytes`);
        console.log(`[SecSignService] AuthToken:    ${authToken ? authToken.substring(0, 20) + '...' : 'MISSING'}`);

        const response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Basic ${authToken}`   // FSM authToken used directly
            }
        });

        console.log(`[SecSignService] Response | status: ${response.status}`);
        console.log(`[SecSignService] Response data:`, JSON.stringify(response.data, null, 2));

        return response.data;
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Fetch the SecSign URL from SECSIGN_CONNECT destination.
     * NoAuthentication destination – only URL is used, auth comes from authToken.
     */
    async _getUrl() {
        const destination = await DestinationService.getDestination('SECSIGN_CONNECT');
        const url         = destination.destinationConfiguration.URL;
        console.log(`[SecSignService] Destination URL resolved: ${url}`);
        return url;
    }
}

module.exports = new SecSignService();