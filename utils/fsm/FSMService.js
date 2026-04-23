/**
 * FSMService.js
 *
 * Backend service for SAP FSM API integration.
 * Scoped to the document signing app:
 *
 *   - Core HTTP helpers  (GET, PATCH via Data API; Query API)
 *   - Activity           (read + update)
 *   - UDF Meta           (resolve UDF external IDs)
 *   - Attachments        (list, content, binary buffer, create with content)
 *
 * @file utils/fsm/FSMService.js
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

    async getActivityById(activityId) {
        return this.makeRequest(`/Activity/${activityId}`, { dtos: 'Activity.40' });
    }

    async updateActivity(activityId, updateData) {
        const { dest, token } = await this._auth();
        const response = await axios.put(
            `${dest.URL}/api/data/v4/Activity/${activityId}`,
            updateData,
            { params: { dtos: 'Activity.40', ...this._accountParams(dest) }, headers: this._headers(dest, token) }
        );
        return response.data;
    }

    // =========================================================================
    // UDF META
    // =========================================================================

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

    async getAttachmentsForObject(objectId) {
        try {
            const query = `SELECT w FROM Attachment w WHERE w.object.objectId = '${objectId}'`;
            console.log(`[FSMService] Fetching attachments | objectId: ${objectId}`);
            const data = await this.makeQueryRequest(query, 'Attachment.8');

            if (!data.data || data.data.length === 0) return [];

            const attachments = data.data.map(item => ({
                id:       item.w.id       || 'N/A',
                fileName: item.w.fileName || 'N/A',
                type:     item.w.type     || 'N/A'
            }));
            console.log(`[FSMService] Attachments loaded | objectId: ${objectId} | count: ${attachments.length}`);
            return attachments;

        } catch (error) {
            console.error('[FSMService] Attachments error:', error.response?.data || error.message);
            throw error;
        }
    }

    async getAttachmentContent(attachmentId) {
        try {
            const { dest, token } = await this._auth();
            const response = await axios.get(
                `${dest.URL}/api/data/v4/Attachment/${attachmentId}/content`,
                { params: this._accountParams(dest), headers: this._headers(dest, token), responseType: 'arraybuffer' }
            );
            const base64      = Buffer.from(response.data).toString('base64');
            const contentType = response.headers['content-type'] || 'application/pdf';
            console.log(`[FSMService] Attachment content | id: ${attachmentId} | size: ${response.data.byteLength} bytes`);
            return { base64, contentType };
        } catch (error) {
            console.error(`[FSMService] Attachment content error for ${attachmentId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async getAttachmentBuffer(attachmentId) {
        try {
            const { dest, token } = await this._auth();
            const response = await axios.get(
                `${dest.URL}/api/data/v4/Attachment/${attachmentId}/content`,
                { params: this._accountParams(dest), headers: this._headers(dest, token), responseType: 'arraybuffer' }
            );
            console.log(`[FSMService] Attachment buffer | id: ${attachmentId} | size: ${response.data.byteLength} bytes`);
            return Buffer.from(response.data);
        } catch (error) {
            console.error(`[FSMService] Attachment buffer error for ${attachmentId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Create a new FSM Attachment with binary content in a single call.
     * fileContent is sent as base64. Linked to Activity via object.objectId.
     *
     * @param {string} objectId   - FSM Activity cloudId
     * @param {string} objectType - 'ACTIVITY' | 'SERVICECALL'
     * @param {string} fileName   - e.g. "Signed - TEST.pdf"
     * @param {Buffer} buffer     - PDF binary
     * @returns {Promise<string>} new attachment ID
     */
    async createAttachmentWithContent(objectId, objectType, fileName, buffer) {
        try {
            const { dest, token } = await this._auth();

            const response = await axios.post(
                `${dest.URL}/api/data/v4/Attachment`,
                {
                    object:      { objectId, objectType },
                    fileName:    fileName,
                    type:        'PDF',
                    fileContent: buffer.toString('base64')
                },
                { params: { dtos: 'Attachment.8', ...this._accountParams(dest) }, headers: this._headers(dest, token) }
            );

            const newId = response.data?.data?.[0]?.attachment?.id;
            if (!newId) throw new Error('Attachment creation returned no ID');

            console.log(`[FSMService] Attachment created | id: ${newId} | fileName: ${fileName}`);
            return newId;

        } catch (error) {
            console.error('[FSMService] Create attachment error:', error.response?.data || error.message);
            throw error;
        }
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    async _auth() {
        const destination = await DestinationService.getDestination('FSM_OAUTH_CONNECT');
        const token       = await TokenCache.getToken(destination);
        return { dest: destination.destinationConfiguration, token };
    }

    _accountParams(dest) {
        return {
            account: dest.account || this.config.account,
            company: dest.company || this.config.company
        };
    }

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