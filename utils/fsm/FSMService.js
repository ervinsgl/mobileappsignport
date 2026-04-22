/**
 * FSMService.js
 *
 * Backend service for SAP FSM API integration.
 * Scoped to the document signing app – covers only what this app needs:
 *
 *   - Core HTTP helpers     (GET, PATCH via Data API; Query API)
 *   - Activity              (read + update for signing UDF writeback)
 *   - UDF Meta              (resolve UDF external IDs)
 *   - Attachments           (list, content, binary buffer)
 *
 * @file utils/fsm/FSMService.js
 * @module utils/fsm/FSMService
 * @requires axios
 * @requires ./DestinationService
 * @requires ./TokenCache
 */
const axios              = require('axios');
const DestinationService = require('./DestinationService');
const TokenCache         = require('./TokenCache');

class FSMService {

    constructor() {
        this.config = {
            account: 'tuev-nord_t1',
            company: 'TUEV-NORD_S4E'
        };
    }

    // =========================================================================
    // CORE HTTP HELPERS
    // =========================================================================

    /**
     * GET request to FSM Data API (/api/data/v4).
     * @param {string} path   - e.g. '/Activity/123'
     * @param {Object} params - additional query params
     */
    async makeRequest(path, params = {}) {
        try {
            const { dest, token } = await this._auth();
            const response = await axios.get(
                `${dest.URL}/api/data/v4${path}`,
                { params: { ...params, ...this._accountParams(dest) }, headers: this._headers(dest, token) }
            );
            return response.data;
        } catch (error) {
            console.error('[FSMService] GET error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * PATCH request to FSM Data API (/api/data/v4).
     * Always sends forceUpdate=true.
     * @param {string} path   - e.g. '/Activity/123'
     * @param {Object} data   - request body
     * @param {Object} params - additional query params
     */
    async patchRequest(path, data, params = {}) {
        try {
            const { dest, token } = await this._auth();
            const response = await axios.patch(
                `${dest.URL}/api/data/v4${path}`,
                data,
                { params: { forceUpdate: true, ...params, ...this._accountParams(dest) }, headers: this._headers(dest, token) }
            );
            return response.data;
        } catch (error) {
            console.error('[FSMService] PATCH error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * GET request to FSM Query API (/api/query/v1).
     * @param {string} query - FSM query string
     * @param {string} dtos  - DTO version string, e.g. 'Attachment.8'
     */
    async makeQueryRequest(query, dtos) {
        try {
            const { dest, token } = await this._auth();
            const response = await axios.get(
                `${dest.URL}/api/query/v1`,
                { params: { query, dtos, ...this._accountParams(dest) }, headers: this._headers(dest, token) }
            );
            return response.data;
        } catch (error) {
            console.error('[FSMService] Query error:', error.response?.data || error.message);
            throw error;
        }
    }

    // =========================================================================
    // ACTIVITY
    // =========================================================================

    /**
     * Fetch a single Activity by ID.
     * @param {string} activityId
     */
    async getActivityById(activityId) {
        return this.makeRequest(`/Activity/${activityId}`, { dtos: 'Activity.40' });
    }

    /**
     * Update an Activity (PUT).
     * Used to write back signing UDFs after document is signed.
     * @param {string} activityId
     * @param {Object} updateData - must include lastChanged
     */
    async updateActivity(activityId, updateData) {
        const { dest, token } = await this._auth();
        const response = await axios.put(
            `${dest.URL}/api/data/v4/Activity/${activityId}`,
            updateData,
            {
                params:  { dtos: 'Activity.40', ...this._accountParams(dest) },
                headers: this._headers(dest, token)
            }
        );
        return response.data;
    }

    // =========================================================================
    // UDF META
    // =========================================================================

    /**
     * Resolve a UDF meta ID to its externalId string.
     * @param {string} udfMetaId
     * @returns {Promise<string|null>}
     */
    async getUdfMetaById(udfMetaId) {
        try {
            const query = `SELECT w.externalId FROM UdfMeta w WHERE w.id = '${udfMetaId}'`;
            const data  = await this.makeQueryRequest(query, 'UdfMeta.20');
            if (!data.data || data.data.length === 0) return null;
            return data.data[0]?.w?.externalId || null;
        } catch (error) {
            console.error('[FSMService] UDF meta error:', error.message);
            return null;
        }
    }

    // =========================================================================
    // ATTACHMENTS
    // =========================================================================

    /**
     * Get all attachments linked to a given FSM object.
     * Query: SELECT w FROM Attachment w WHERE w.object.objectId = '<objectId>'
     *
     * @param {string} objectId - from context cloudId
     * @returns {Promise<Array<{ id, fileName, type }>>}
     */
    async getAttachmentsForObject(objectId) {
        try {
            const query = `SELECT w FROM Attachment w WHERE w.object.objectId = '${objectId}'`;
            console.log(`[FSMService] Fetching attachments | objectId: ${objectId}`);

            const data = await this.makeQueryRequest(query, 'Attachment.8');
            console.log(`[FSMService] Raw attachment response:`, JSON.stringify(data, null, 2));

            if (!data.data || data.data.length === 0) {
                console.log(`[FSMService] No attachments found for objectId: ${objectId}`);
                return [];
            }

            const attachments = data.data.map(item => {
                const w = item.w;
                return {
                    id:       w.id       || 'N/A',
                    fileName: w.fileName || 'N/A',
                    type:     w.type     || 'N/A'
                };
            });

            console.log(`[FSMService] Mapped ${attachments.length} attachment(s):`, attachments);
            return attachments;

        } catch (error) {
            console.error('[FSMService] Attachments error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Fetch attachment binary as base64 + contentType.
     * Used for the content preview column in the table.
     * @param {string} attachmentId
     * @returns {Promise<{ base64: string, contentType: string }>}
     */
    async getAttachmentContent(attachmentId) {
        try {
            const { dest, token } = await this._auth();
            const response = await axios.get(
                `${dest.URL}/api/data/v4/Attachment/${attachmentId}/content`,
                {
                    params:       this._accountParams(dest),
                    headers:      this._headers(dest, token),
                    responseType: 'arraybuffer'
                }
            );

            const base64      = Buffer.from(response.data).toString('base64');
            const contentType = response.headers['content-type'] || 'application/pdf';

            console.log(`[FSMService] Attachment content | id: ${attachmentId} | size: ${response.data.byteLength} bytes | type: ${contentType}`);
            return { base64, contentType };

        } catch (error) {
            console.error(`[FSMService] Attachment content error for ${attachmentId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Fetch attachment binary as a raw Buffer.
     * Used by attachment-pdf route (PDFViewer) and signing trigger (send to CI/SecSign).
     * @param {string} attachmentId
     * @returns {Promise<Buffer>}
     */
    async getAttachmentBuffer(attachmentId) {
        try {
            const { dest, token } = await this._auth();
            const response = await axios.get(
                `${dest.URL}/api/data/v4/Attachment/${attachmentId}/content`,
                {
                    params:       this._accountParams(dest),
                    headers:      this._headers(dest, token),
                    responseType: 'arraybuffer'
                }
            );
            console.log(`[FSMService] Attachment buffer | id: ${attachmentId} | size: ${response.data.byteLength} bytes`);
            return Buffer.from(response.data);
        } catch (error) {
            console.error(`[FSMService] Attachment buffer error for ${attachmentId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /** Resolve destination config + fresh token in one call. */
    async _auth() {
        const destination = await DestinationService.getDestination('FSM_OAUTH_CONNECT');
        const token       = await TokenCache.getToken(destination);
        return { dest: destination.destinationConfiguration, token };
    }

    /** Standard account/company query params. */
    _accountParams(dest) {
        return {
            account: dest.account || this.config.account,
            company: dest.company || this.config.company
        };
    }

    /** Standard request headers. */
    _headers(dest, token) {
        return {
            'Content-Type':     'application/json',
            'Authorization':    `Bearer ${token}`,
            'X-Account-ID':     dest['URL.headers.X-Account-ID'],
            'X-Company-ID':     dest['URL.headers.X-Company-ID'],
            'X-Client-ID':      dest['URL.headers.X-Client-ID'],
            'X-Client-Version': dest['URL.headers.X-Client-Version']
        };
    }
}

module.exports = new FSMService();