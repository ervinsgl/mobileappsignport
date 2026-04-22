/**
 * DestinationService.js
 *
 * SAP BTP Destination Service integration.
 * Fetches destination configuration and auth tokens from BTP.
 *
 * Two methods:
 *   getDestination(name)          – returns full destination config (existing behaviour)
 *   getDestinationToken(name)     – returns BTP-issued authToken for the destination
 *                                   (for NoAuthentication destinations where we need
 *                                    to attach our own auth header + route via BTP proxy)
 *
 * @file utils/fsm/DestinationService.js
 * @requires axios
 */
const axios = require('axios');

class DestinationService {

    /**
     * Get Destination Service credentials from VCAP_SERVICES.
     * @returns {Object}
     */
    getCredentials() {
        const vcapServices      = JSON.parse(process.env.VCAP_SERVICES || '{}');
        const destinationService = vcapServices.destination?.[0];

        if (!destinationService) {
            throw new Error('Destination service not bound to application');
        }

        return destinationService.credentials;
    }

    /**
     * Get destination configuration from BTP.
     * Returns destinationConfiguration + authTokens if available.
     *
     * @param {string} destinationName
     * @returns {Promise<Object>}
     */
    async getDestination(destinationName) {
        try {
            const { accessToken, credentials } = await this._getBtpToken();

            const destinationResponse = await axios.get(
                `${credentials.uri}/destination-configuration/v1/destinations/${destinationName}`,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );

            console.log(`[DestinationService] Loaded: ${destinationName}`);
            return destinationResponse.data;

        } catch (error) {
            console.error(`[DestinationService] Error loading ${destinationName}:`, error.response?.data || error.message);
            throw new Error(`Failed to load destination: ${destinationName}`);
        }
    }

    /**
     * Get the connectivity proxy details for making calls THROUGH BTP to
     * internet destinations. Returns the proxy host/port from VCAP_SERVICES
     * connectivity binding so axios can route via SAP's outbound proxy.
     *
     * @returns {{ proxyHost: string, proxyPort: number, proxyToken: string } | null}
     */
    async getConnectivityProxy() {
        try {
            const vcapServices = JSON.parse(process.env.VCAP_SERVICES || '{}');
            const connectivity = vcapServices.connectivity?.[0];

            if (!connectivity) {
                console.warn('[DestinationService] No connectivity service bound – direct axios call will be used');
                return null;
            }

            const creds = connectivity.credentials;

            // Get proxy token from connectivity service
            const tokenResponse = await axios.post(
                creds.token_service_uri + '/oauth/token',
                new URLSearchParams({
                    grant_type:    'client_credentials',
                    client_id:     creds.clientid,
                    client_secret: creds.clientsecret
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            console.log(`[DestinationService] Connectivity proxy token obtained`);

            return {
                proxyHost:  creds['onpremise_proxy_host'],
                proxyPort:  parseInt(creds['onpremise_proxy_port'], 10),
                proxyToken: tokenResponse.data.access_token
            };

        } catch (error) {
            console.warn('[DestinationService] Connectivity proxy unavailable:', error.message);
            return null;
        }
    }

    // ── Private ──────────────────────────────────────────────────────────────

    async _getBtpToken() {
        const credentials = this.getCredentials();

        const tokenResponse = await axios.post(
            credentials.url + '/oauth/token',
            new URLSearchParams({
                grant_type:    'client_credentials',
                client_id:     credentials.clientid,
                client_secret: credentials.clientsecret
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        return { accessToken: tokenResponse.data.access_token, credentials };
    }
}

module.exports = new DestinationService();