sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "mobileappsignport/utils/ContextService"
], (Controller, JSONModel, ContextService) => {
    "use strict";

    return Controller.extend("mobileappsignport.controller.View1", {

        onInit() {
            this.getView().setModel(new JSONModel({
                busy: true,
                contextLoaded: false,
                showError: false,
                context: {},
                attachments: [],
                attachmentsBusy: false,
                attachmentsLoaded: false
            }), "view");

            this._loadContext();
        },

        async _loadContext() {
            const oModel = this.getView().getModel("view");

            try {
                const context = await ContextService.getContext();

                oModel.setProperty("/context", context);
                oModel.setProperty("/contextLoaded", true);
                oModel.setProperty("/busy", false);

                console.log("FSM context loaded:", {
                    source: context.source,
                    user: context.userName,
                    company: context.companyName,
                    objectType: context.objectType,
                    cloudId: context.cloudId
                });

                // Load attachments once we have a cloudId
                if (context.cloudId && context.cloudId !== "N/A") {
                    this._loadAttachments(context.cloudId);
                } else {
                    console.warn("No cloudId in context – skipping attachment load");
                }

            } catch (error) {
                console.warn("FSM context not available:", error.message);
                oModel.setProperty("/showError", true);
                oModel.setProperty("/busy", false);
            }
        },

        async _loadAttachments(objectId) {
            const oModel = this.getView().getModel("view");

            oModel.setProperty("/attachmentsBusy", true);
            console.log("Loading attachments for objectId:", objectId);

            try {
                const response = await fetch(`/api/attachments/${encodeURIComponent(objectId)}`);

                console.log("Attachments response status:", response.status);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const attachments = await response.json();
                console.log("Attachments received:", attachments.length, attachments);

                // Fetch content for each attachment in parallel
                const enriched = await Promise.all(
                    attachments.map(att => this._fetchAttachmentContent(att))
                );

                oModel.setProperty("/attachments", enriched);
                oModel.setProperty("/attachmentsLoaded", true);
                oModel.setProperty("/attachmentsBusy", false);

            } catch (error) {
                console.error("Failed to load attachments:", error.message);
                oModel.setProperty("/attachmentsBusy", false);
                oModel.setProperty("/attachmentsLoaded", true);
            }
        },

        async _fetchAttachmentContent(attachment) {
            try {
                const response = await fetch(`/api/attachment-content/${encodeURIComponent(attachment.id)}`);

                if (!response.ok) {
                    console.warn(`Content fetch failed for ${attachment.id}: HTTP ${response.status}`);
                    return { ...attachment, content: "N/A", contentType: "application/pdf" };
                }

                const result = await response.json();

                console.log(`Content fetched for ${attachment.id} | size: ${result.base64?.length} chars`);

                // Store full base64 for later use (signing), show truncated in UI
                const preview = result.base64
                    ? result.base64.substring(0, 60) + "..."
                    : "N/A";

                return {
                    ...attachment,
                    content:     preview,
                    contentFull: result.base64,       // full base64 – available for signing phase
                    contentType: result.contentType || "application/pdf"
                };

            } catch (error) {
                console.error(`Content fetch error for ${attachment.id}:`, error.message);
                return { ...attachment, content: "Error", contentType: "application/pdf" };
            }
        }

    });
});