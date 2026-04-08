/**
 * CIService.js
 *
 * Backend service for SAP Integration Suite (Cloud Integration) calls.
 * Uses the CI_BASIC_CONNECT BTP destination (BasicAuthentication).
 *
 * The BTP Destination Service resolves credentials and returns:
 *   destinationConfiguration.URL      – iFlow base URL
 *   destinationConfiguration.User     – Basic auth username
 *   destinationConfiguration.Password – Basic auth password
 *
 * @file utils/CIService.js
 * @requires axios
 * @requires ./DestinationService
 */
const axios              = require('axios');
const DestinationService = require('./DestinationService');

class CIService {

    // =========================================================================
    // SIGNING
    // =========================================================================

    /**
     * Trigger the signing iFlow on SAP Integration Suite.
     * Called when the user presses "Sign PDF" on an attachment.
     *
     * @param {Object} payload
     * @param {string} payload.attachmentId  - FSM attachment ID
     * @param {string} payload.fileName      - Attachment file name
     * @param {string} payload.objectId      - FSM object (activity) ID
     * @param {string} payload.userName      - FSM user name
     * @returns {Promise<Object>} iFlow response
     */
    async triggerSigning(payload) {
        const dest = await this._getDestConfig();

        const url      = dest.URL;
        const authHeader = this._basicAuth(dest.User, dest.Password);

        console.log(`[CIService] Triggering signing iFlow | url: ${url}`);
        console.log(`[CIService] Payload:`, JSON.stringify(payload, null, 2));

        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type':  'application/json',
                'Authorization': authHeader
            }
        });

        console.log(`[CIService] iFlow response | status: ${response.status}`);
        console.log(`[CIService] iFlow response data:`, JSON.stringify(response.data, null, 2));

        return response.data;
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /** Fetch and return the CI_BASIC_CONNECT destination configuration. */
    async _getDestConfig() {
        const destination = await DestinationService.getDestination('CI_BASIC_CONNECT');
        const config      = destination.destinationConfiguration;

        console.log(`[CIService] Destination resolved | URL: ${config.URL} | User: ${config.User}`);
        return config;
    }

    /** Build a Basic Authorization header value. */
    _basicAuth(user, password) {
        const encoded = Buffer.from(`${user}:${password}`).toString('base64');
        return `Basic ${encoded}`;
    }
}

module.exports = new CIService();