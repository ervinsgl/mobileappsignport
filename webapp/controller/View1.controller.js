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

                oModel.setProperty("/attachments", attachments);
                oModel.setProperty("/attachmentsLoaded", true);
                oModel.setProperty("/attachmentsBusy", false);

            } catch (error) {
                console.error("Failed to load attachments:", error.message);
                oModel.setProperty("/attachmentsBusy", false);
                oModel.setProperty("/attachmentsLoaded", true); // show empty table, not spinner
            }
        }

    });
});